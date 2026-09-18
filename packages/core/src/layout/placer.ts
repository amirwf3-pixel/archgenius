/**
 * Constraint-based deterministic placer (Phase 3).
 *
 * Carves footprint into architectural zones (public / service / circulation
 * / private). For the public band we use a recursive binary splitter. For
 * the private band we use a COLUMN layout: X is split into bedroom-bath
 * columns, each column Y-split into a corridor-edge bath/closet strip and
 * a bedroom above — the canonical Iranian residential section. For
 * vertical-spine strategies (daylight-orientation) we mirror the logic.
 */
import type { Rect } from '../geometry/rect.js';
import { rSplitX, rSplitY, rArea, rCorners } from '../geometry/rect.js';
import type { Space, SpaceSpec, Zone, SpaceType } from '../model/space.js';
import type { CandidateStrategy } from '../model/layout.js';

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
): ZoneLayout {
  const zones: Record<Zone, Rect[]> = {
    public: [], 'semi-private': [], private: [], service: [], circulation: [],
  };
  const corridors: Rect[] = [];
  let entrancePatch: Rect | undefined;

  if (cfg.spine === 'vertical') {
    const vx = footprint.x + footprint.w * (cfg.verticalCorridorFraction ?? 0.5) - CORRIDOR_W / 2;
    corridors.push({ x: vx, y: footprint.y, w: CORRIDOR_W, h: footprint.h });
    zones.public.push({ x: footprint.x, y: footprint.y, w: vx - footprint.x, h: footprint.h });
    let eastRect: Rect = { x: vx + CORRIDOR_W, y: footprint.y, w: footprint.x + footprint.w - (vx + CORRIDOR_W), h: footprint.h };
    // Stair pocket for vertical spine: at south end of private band (near entrance)
    if (needStair && eastRect.h > 5.5) {
      const pocketH = Math.min(2.9, Math.max(2.6, eastRect.h * 0.20));
      const pocketW = Math.min(4.6, Math.max(4.2, eastRect.w * 0.55));
      zones.service.push({ x: eastRect.x, y: eastRect.y, w: pocketW, h: pocketH });
      eastRect = { x: eastRect.x, y: eastRect.y + pocketH, w: eastRect.w, h: eastRect.h - pocketH };
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
  // — upper residential floors typically don't). Shrink strip to fit narrow
  // sites (minimum 1.50 m) so the rest of the plan doesn't collapse.
  let publicMain: Rect = publicWork;
  if (hasKitchen) {
    const kw = Math.max(1.5, Math.min(KITCHEN_W, publicWork.w * 0.25));
    if (publicWork.w > kw + 2.5) {
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
  const cfg = strategyConfig(strategy);
  const needStair = specs.some(s => s.type === 'stair-hall');
  const hasKitchen = specs.some(s => s.type === 'kitchen');
  const layout = carveZones(footprint, cfg, needStair, hasKitchen);
  const explanation: string[] = [`Strategy ${strategy}: ${cfg.spine} spine, corridor @ ${Math.round(cfg.corridorOffsetFraction*100)}% depth.`];

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

  // --- Entrance spur ---
  if (layout.entrancePatch) {
    const patch = layout.entrancePatch;
    const entH = Math.min(1.8, patch.h * 0.4);
    const ent = take('entrance'); if (ent)
      placed.push(mkSpace('entrance', { x: patch.x, y: patch.y, w: patch.w, h: entH }, ent.placedLabel, ent.placedId, 'public'));
    const foy = take('foyer'); if (foy)
      placed.push(mkSpace('foyer', { x: patch.x, y: patch.y + entH, w: patch.w, h: patch.h - entH }, foy.placedLabel, foy.placedId, 'public'));
  } else {
    // No spur: entrance placed against facade in public rect in the recursive pass below.
  }

  // --- Private band: column layout ---
  // Phase 12: Constraint-aware placement — HARD constraints influence geometry BEFORE final validation
  // For corridor-bedroom/bath direct access hard: each bedroom/bath/master must touch corridor (south edge at privateRect.y)
  // For master cluster: master bedroom and master bathroom must both touch corridor and be adjacent to each other (side-by-side)
  const privateRect = layout.zones.private[0];
  if (privateRect) {
    const mbath = take('master-bathroom');
    const mbed = take('master-bedroom');
    const baths: PlacedSpec[] = [];
    const beds: PlacedSpec[] = [];
    let b; while ((b = take('bedroom'))) beds.push(b);
    let bt; while ((bt = take('bathroom'))) baths.push(bt);
    const extraMbath = take('master-bathroom');
    if (extraMbath) baths.push(extraMbath);

    // Phase 12: Build constraint-aware clusters
    // Each cluster will be placed as side-by-side rooms both touching corridor, satisfying:
    // - c-corr-bed, c-corr-mbed, c-corr-bath, c-corr-mbath (hard direct access / adjacency)
    // - p-mb-mbath soft adjacency (master bedroom adjacent to master bathroom)
    interface PrivateCluster {
      id: string;
      rooms: PlacedSpec[]; // 1 or 2 rooms
      isMaster: boolean;
    }
    const clusters: PrivateCluster[] = [];

    // Master cluster first (high priority: hard adjacency + hard direct access)
    if (mbed || mbath) {
      const rooms: PlacedSpec[] = [];
      if (mbed) rooms.push(mbed);
      if (mbath) rooms.push(mbath);
      clusters.push({ id: 'master-cluster', rooms, isMaster: true });
    }

    // Regular bedroom-bathroom clusters
    const maxPairs = Math.max(beds.length, baths.length);
    for (let i = 0; i < maxPairs; i++) {
      const bed = beds[i];
      const bath = baths[i];
      if (bed && bath) {
        clusters.push({ id: `bed-bath-${i}`, rooms: [bed, bath], isMaster: false });
      } else if (bed) {
        clusters.push({ id: `bed-${i}`, rooms: [bed], isMaster: false });
      } else if (bath) {
        clusters.push({ id: `bath-${i}`, rooms: [bath], isMaster: false });
      }
    }

    // Placement ordering: master cluster first, then larger target area clusters, deterministic tie-break by id
    clusters.sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
      const areaA = a.rooms.reduce((sum, r) => sum + Math.max(r.minArea, r.targetArea), 0);
      const areaB = b.rooms.reduce((sum, r) => sum + Math.max(r.minArea, r.targetArea), 0);
      if (areaA !== areaB) return areaB - areaA;
      return a.id.localeCompare(b.id);
    });

    // Phase 12 feasibility check: can we place all private rooms side-by-side touching corridor while respecting minWidth/minLength?
    // For horizontal spine, need sum(minWidths) <= privateRect.w; for vertical, sum(minHeights) <= privateRect.h
    // If not feasible, fallback to legacy column layout that satisfies minWidth but may violate corridor adjacency (honest HARD)
    const computeMinWidth = (spec: PlacedSpec): number => Math.max(spec.minWidth ?? 2.0, 1.0);
    const computeMinHeight = (spec: PlacedSpec): number => Math.max(spec.minLength ?? spec.minWidth ?? 2.0, 1.0);

    let feasibleSideBySide = true;
    let requiredTotal = 0;
    const isVerticalSpineCheck = cfg.spine === 'vertical';
    if (isVerticalSpineCheck) {
      for (const cl of clusters) {
        if (cl.rooms.length === 2) {
          requiredTotal += cl.rooms.reduce((s, r) => s + computeMinHeight(r), 0);
        } else {
          requiredTotal += computeMinHeight(cl.rooms[0]);
        }
      }
      if (requiredTotal > privateRect.h + 1e-6) feasibleSideBySide = false;
    } else {
      for (const cl of clusters) {
        if (cl.rooms.length === 2) {
          requiredTotal += cl.rooms.reduce((s, r) => s + computeMinWidth(r), 0);
        } else {
          requiredTotal += computeMinWidth(cl.rooms[0]);
        }
      }
      if (requiredTotal > privateRect.w + 1e-6) feasibleSideBySide = false;
    }

    if (clusters.length > 0) {
      const totalArea = clusters.reduce((sum, cl) => sum + cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0), 0);
      const isVerticalSpine = cfg.spine === 'vertical';

      if (!feasibleSideBySide) {
        // Fallback to legacy column layout (Phase 3) that respects minWidth but may violate hard corridor adjacency
        // This is honest infeasibility handling: we cannot satisfy both minWidth HARD and corridor adjacency HARD simultaneously
        explanation.push(`Phase12 INFEASIBLE side-by-side: required ${requiredTotal.toFixed(2)}m > available ${isVerticalSpine ? privateRect.h.toFixed(2) : privateRect.w.toFixed(2)}m — falling back to legacy column layout (will report CONSTRAINT_MUST_ADJACENT HARD)`);
        // Legacy: columns per bedroom, master first, bath at corridor edge, bedroom above
        const mbedLegacy = clusters.find(c => c.isMaster)?.rooms.find(r => r.type === 'master-bedroom');
        const mbathLegacy = clusters.find(c => c.isMaster)?.rooms.find(r => r.type === 'master-bathroom');
        const bedsLegacy: PlacedSpec[] = [];
        const bathsLegacy: PlacedSpec[] = [];
        for (const cl of clusters) {
          if (cl.isMaster) continue;
          for (const r of cl.rooms) {
            if (r.type === 'bedroom') bedsLegacy.push(r);
            else if (r.type === 'bathroom') bathsLegacy.push(r);
          }
        }
        const columns = (mbedLegacy ? 1 : 0) + bedsLegacy.length;
        if (columns > 0) {
          const weights: number[] = [];
          if (mbedLegacy) weights.push(1.45);
          for (let i = 0; i < bedsLegacy.length; i++) weights.push(1.0);
          const totalW = weights.reduce((a,b)=>a+b,0);
          let x = privateRect.x;
          const colRects: Rect[] = [];
          for (let i = 0; i < weights.length; i++) {
            const w = (i === weights.length - 1) ? privateRect.x + privateRect.w - x : privateRect.w * weights[i] / totalW;
            colRects.push({ x, y: privateRect.y, w, h: privateRect.h });
            x += w;
          }
          if (mbedLegacy && colRects.length > 0) {
            const col = colRects.shift()!;
            if (mbathLegacy) {
              const bh = Math.min(BATH_STRIP_H + 0.4, col.h * 0.3);
              placed.push(mkSpace('master-bathroom', { x: col.x, y: col.y, w: col.w, h: bh }, mbathLegacy.placedLabel, mbathLegacy.placedId, 'private'));
              placed.push(mkSpace('master-bedroom', { x: col.x, y: col.y + bh, w: col.w, h: col.h - bh }, mbedLegacy.placedLabel, mbedLegacy.placedId, 'private'));
            } else {
              placed.push(mkSpace('master-bedroom', col, mbedLegacy.placedLabel, mbedLegacy.placedId, 'private'));
            }
          }
          for (let i = 0; i < bedsLegacy.length; i++) {
            const col = colRects[i]; if (!col) break;
            const bed = bedsLegacy[i];
            const bath = bathsLegacy[i];
            if (bath) {
              const bh = Math.min(BATH_STRIP_H, col.h * 0.3);
              placed.push(mkSpace('bathroom', { x: col.x, y: col.y, w: col.w, h: bh }, bath.placedLabel, bath.placedId, 'private'));
              placed.push(mkSpace('bedroom', { x: col.x, y: col.y + bh, w: col.w, h: col.h - bh }, bed.placedLabel, bed.placedId, 'private'));
            } else {
              placed.push(mkSpace('bedroom', col, bed.placedLabel, bed.placedId, 'private'));
            }
          }
        }
      } else if (isVerticalSpine) {
        // Vertical spine: corridor is vertical west of privateRect, so adjacency requires west edge at privateRect.x
        // Stack clusters vertically, each touching corridor via west edge — minHeight respecting
        const clusterMinHs = clusters.map(cl => {
          if (cl.rooms.length === 2) return cl.rooms.reduce((s, r) => s + Math.max(r.minLength ?? r.minWidth ?? 2.0, 1.0), 0);
          return Math.max(cl.rooms[0].minLength ?? cl.rooms[0].minWidth ?? 2.0, 1.0);
        });
        const totalMinH = clusterMinHs.reduce((a,b)=>a+b,0);
        const totalExtraAreaV = clusters.reduce((sum, cl) => {
          const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
          const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
          return sum + Math.max(0, target - minArea);
        }, 0);
        const remainingH = privateRect.h - totalMinH;

        let y = privateRect.y;
        for (let ci = 0; ci < clusters.length; ci++) {
          const cl = clusters[ci];
          const isLast = ci === clusters.length - 1;
          let rowH: number;
          if (isLast) {
            rowH = privateRect.y + privateRect.h - y;
          } else {
            const minH = clusterMinHs[ci];
            const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
            const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
            const extra = Math.max(0, target - minArea);
            const extraShare = totalExtraAreaV > 1e-6 ? (extra / totalExtraAreaV) * remainingH : remainingH / clusters.length;
            rowH = minH + extraShare;
          }
          const rowRect: Rect = { x: privateRect.x, y, w: privateRect.w, h: rowH };
          y += rowH;

          if (cl.rooms.length === 2) {
            const r1 = cl.rooms[0];
            const r2 = cl.rooms[1];
            const bedroom = r1.type.includes('bedroom') ? r1 : r2.type.includes('bedroom') ? r2 : r1;
            const bathroom = r1.type.includes('bathroom') ? r1 : r2.type.includes('bathroom') ? r2 : r2;
            const bedMinH = Math.max(bedroom.minLength ?? bedroom.minWidth ?? 2.2, 2.0);
            const bathMinH = Math.max(bathroom.minLength ?? bathroom.minWidth ?? 1.2, 1.0);
            const bedTarget = Math.max(bedroom.minArea, bedroom.targetArea);
            const bathTarget = Math.max(bathroom.minArea, bathroom.targetArea);
            const clusterMin = bedMinH + bathMinH;
            const clusterExtra = Math.max(0, rowH - clusterMin);
            const totalClusterTarget = bedTarget + bathTarget;
            let bedH: number, bathH: number;
            if (totalClusterTarget > 1e-6) {
              bedH = bedMinH + clusterExtra * (bedTarget / totalClusterTarget);
              bathH = rowH - bedH;
              if (bathH < bathMinH) { bathH = bathMinH; bedH = rowH - bathH; }
              if (bedH < bedMinH) { bedH = bedMinH; bathH = rowH - bedH; }
            } else {
              bedH = rowH * 0.6;
              bathH = rowH - bedH;
            }

            const bedroomIsFirst = cl.rooms[0].type.includes('bedroom');
            const topRect: Rect = { x: rowRect.x, y: rowRect.y, w: rowRect.w, h: bedroomIsFirst ? bedH : bathH };
            const bottomRect: Rect = { x: rowRect.x, y: rowRect.y + (bedroomIsFirst ? bedH : bathH), w: rowRect.w, h: bedroomIsFirst ? bathH : bedH };

            const firstSpec = cl.rooms[0];
            const secondSpec = cl.rooms[1];
            placed.push(mkSpace(firstSpec.type, topRect, firstSpec.placedLabel, firstSpec.placedId, 'private'));
            placed.push(mkSpace(secondSpec.type, bottomRect, secondSpec.placedLabel, secondSpec.placedId, 'private'));
            explanation.push(`Phase12 vertical: cluster ${cl.id} stacked ${firstSpec.type}+${secondSpec.type} both touching corridor west edge minH-respecting`);
          } else {
            const single = cl.rooms[0];
            placed.push(mkSpace(single.type, rowRect, single.placedLabel, single.placedId, 'private'));
            explanation.push(`Phase12 vertical: single ${single.type} row touching corridor minH-respecting`);
          }
        }
      } else {
        // Horizontal spine: corridor south of privateRect, adjacency requires south edge at privateRect.y
        // Phase 12: Allocate column widths respecting minWidth HARD, extra distributed by target area
        const clusterMinWs = clusters.map(cl => {
          if (cl.rooms.length === 2) return cl.rooms.reduce((s, r) => s + Math.max(r.minWidth ?? 2.0, 1.0), 0);
          return Math.max(cl.rooms[0].minWidth ?? 2.0, 1.0);
        });
        const totalMinW = clusterMinWs.reduce((a,b)=>a+b,0);
        const totalExtraArea = clusters.reduce((sum, cl, idx) => {
          const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
          const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
          return sum + Math.max(0, target - minArea);
        }, 0);
        const remainingW = privateRect.w - totalMinW;

        let x = privateRect.x;
        for (let ci = 0; ci < clusters.length; ci++) {
          const cl = clusters[ci];
          const isLast = ci === clusters.length - 1;
          let colW: number;
          if (isLast) {
            colW = privateRect.x + privateRect.w - x;
          } else {
            const minW = clusterMinWs[ci];
            const target = cl.rooms.reduce((s, r) => s + Math.max(r.minArea, r.targetArea), 0);
            const minArea = cl.rooms.reduce((s, r) => s + (r.minArea ?? 0), 0);
            const extra = Math.max(0, target - minArea);
            const extraShare = totalExtraArea > 1e-6 ? (extra / totalExtraArea) * remainingW : remainingW / clusters.length;
            colW = minW + extraShare;
          }
          const colRect: Rect = { x, y: privateRect.y, w: colW, h: privateRect.h };
          x += colW;

          if (cl.rooms.length === 2) {
            const r1 = cl.rooms[0];
            const r2 = cl.rooms[1];
            const bedroom = r1.type.includes('bedroom') ? r1 : r2.type.includes('bedroom') ? r2 : r1;
            const bathroom = r1.type.includes('bathroom') ? r1 : r2.type.includes('bathroom') ? r2 : r2;
            const bedroomIsFirst = cl.rooms[0].type.includes('bedroom');

            // Allocate within cluster respecting minWidths, extra by target area
            const bedMinW = Math.max(bedroom.minWidth ?? 2.2, 2.0);
            const bathMinW = Math.max(bathroom.minWidth ?? 1.2, 1.0);
            const bedTarget = Math.max(bedroom.minArea, bedroom.targetArea);
            const bathTarget = Math.max(bathroom.minArea, bathroom.targetArea);
            const clusterMin = bedMinW + bathMinW;
            const clusterExtra = Math.max(0, colW - clusterMin);
            const totalClusterTarget = bedTarget + bathTarget;
            let bedW: number, bathW: number;
            if (totalClusterTarget > 1e-6) {
              bedW = bedMinW + clusterExtra * (bedTarget / totalClusterTarget);
              bathW = colW - bedW;
              // Ensure bathMinW
              if (bathW < bathMinW) { bathW = bathMinW; bedW = colW - bathW; }
              if (bedW < bedMinW) { bedW = bedMinW; bathW = colW - bedW; }
            } else {
              bedW = colW * 0.6;
              bathW = colW - bedW;
            }

            const leftRect: Rect = { x: colRect.x, y: colRect.y, w: bedroomIsFirst ? bedW : bathW, h: colRect.h };
            const rightRect: Rect = { x: colRect.x + (bedroomIsFirst ? bedW : bathW), y: colRect.y, w: bedroomIsFirst ? bathW : bedW, h: colRect.h };

            const firstSpec = cl.rooms[0];
            const secondSpec = cl.rooms[1];
            placed.push(mkSpace(firstSpec.type, leftRect, firstSpec.placedLabel, firstSpec.placedId, 'private'));
            placed.push(mkSpace(secondSpec.type, rightRect, secondSpec.placedLabel, secondSpec.placedId, 'private'));
            explanation.push(`Phase12 constraint-aware: cluster ${cl.id} side-by-side ${firstSpec.type}+${secondSpec.type} both touching corridor (hard direct access satisfied) minW-respecting`);
          } else {
            const single = cl.rooms[0];
            placed.push(mkSpace(single.type, colRect, single.placedLabel, single.placedId, 'private'));
            explanation.push(`Phase12 constraint-aware: single ${single.type} column touching corridor minW-respecting`);
          }
        }
      }
    }

    // Remaining unplaced baths (should be none after clustering)
    let leftover; while ((leftover = baths.slice(clusters.length).shift()) || (leftover = byType.get('bathroom')?.shift())) {
      if (!leftover) break;
    }
  }

  // --- Service band (kitchen / storage / stair-hall / utility) ---
  // Kitchen strip = the service rect whose x is near the east side
  // (kitchen on public east facade); stair pocket = the service rect near
  // the west of the private band.
  const serviceRects = layout.zones.service;
  const kitchenRect = serviceRects.find(r => r.x > footprint.x + footprint.w * 0.6) ?? null;
  let stairPocket: Rect | null = null;
  if (needStair) {
    if (cfg.spine === 'vertical') {
      // Vertical spine: stair pocket is at south end of private band (small y)
      stairPocket = serviceRects.find(r => r.y <= footprint.y + footprint.h * 0.4) ?? serviceRects[0] ?? null;
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
      // No separate pocket: carve stair out of the north end of the kitchen strip.
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
    // Storage/pantry is placed in the kitchen strip AS the corridor-
    // adjacent cell: a small room with door to corridor (pantry/broom
    // closet reachable from circulation), with kitchen south of it.
    // We need to find the kitchen strip first — it is the service rect on
    // the east side of the public band, whose top edge touches corridor.
    // That is where we've placed kitchen (k); carve storage off the top of
    // k. Kitchen then occupies from south facade up to storage, storage
    // from kitchen top to corridor.
    const k = placed.find(p => p.type === 'kitchen');
    if (k) {
      const stripTop = k.rect.y + k.rect.h;
      const storeH = Math.min(2.0, Math.max(1.4, k.rect.h * 0.20));
      // Make sure kitchen STILL reaches the corridor via a door: give
      // kitchen a small door slot by narrowing storage, not by blocking
      // the wall. The openings module creates doors on EVERY wall that
      // touches corridor; if kitchen no longer touches corridor, it's
      // unreachable. Solution: DO NOT place storage between kitchen and
      // corridor — put storage at the SOUTH end of the kitchen strip
      // (facade side) as a pantry with a door into the kitchen. Kitchen
      // then keeps the full north edge against corridor.
      placed.push(mkSpace('storage',
        { x: k.rect.x, y: k.rect.y, w: k.rect.w, h: storeH },
        stor.placedLabel, stor.placedId, 'service'));
      k.rect = { x: k.rect.x, y: k.rect.y + storeH, w: k.rect.w, h: k.rect.h - storeH };
      k.polygon = rCorners(k.rect); k.area = rArea(k.rect);
    }
  }

  // --- Public band ---
  // The entrance spur occupies the west column. The main public rect is
  // arranged as:
  //   - South row: Living (west, facade) and Dining east of it on the south
  //     facade (so dining gets south daylight through a window or is open to
  //     living; dining MUST have an exterior wall to satisfy daylight rule).
  //   - NE corner: guest-wc tucked against the corridor/kitchen wall.
  const publicRect = layout.zones.public[0];
  if (publicRect) {
    const living = take('living');
    const dining = take('dining');
    const guestWc = take('guest-wc');
    const publicUnplaced: PlacedSpec[] = [];
    let g; while ((g = take('guest-room'))) publicUnplaced.push(g);
    let f; while ((f = take('family-room'))) publicUnplaced.push(f);
    let e; while ((e = take('entrance'))) publicUnplaced.push(e);
    let fy; while ((fy = take('foyer'))) publicUnplaced.push(fy);

    if (living) {
      // Public band layout:
      //   - South facade: LIVING and (if present) DINING share the south
      //     wall side-by-side so both have south daylight (this matters for
      //     the MBH4-DYL-001 daylight rule).
      //   - North strip (corridor side): guest-WC tucked in the NE corner,
      //     dining continues north if there is room to reach the corridor
      //     (for a direct door), otherwise dining stays on the facade only.
      // If dining is absent, living spans the whole public band.
      if (dining) {
        // Split south facade between living (larger, west) and dining
        // (east) so BOTH have south daylight. Guest-WC goes in the NE
        // corner (corridor side) of the DINING rectangle — dining keeps
        // a corridor door along its north edge, and WC has a door into
        // the dining/foyer transition without occupying facade width.
        const totalSouthA = Math.max(living.minArea, living.targetArea) + Math.max(dining.minArea, dining.targetArea);
        let livingW = publicRect.w * Math.max(living.minArea, living.targetArea) / totalSouthA;
        livingW = Math.max(3.6, Math.min(publicRect.w - 3.4, livingW));
        placed.push(mkSpace('living',
          { x: publicRect.x, y: publicRect.y, w: livingW, h: publicRect.h },
          living.placedLabel, living.placedId, 'public'));
        const eastX = publicRect.x + livingW;
        const eastW = publicRect.w - livingW;
        // Dining must keep >= 2.2 m clear width (MBH4 §4-5-2-2-2 requires
        // >= 2.15 m for dining; we leave a 5 cm safety margin). Guest-WC
        // is only placed when the east column is wide enough for BOTH.
        const DINING_MIN_W = 2.2;
        const GWC_MIN_W = 1.2;
        if (guestWc && eastW >= DINING_MIN_W + GWC_MIN_W && publicRect.h > 4.0) {
          const gwcW = Math.min(1.6, Math.max(GWC_MIN_W, eastW * 0.30));
          const gwcH = Math.min(2.2, Math.max(1.8, publicRect.h * 0.25));
          const diningW = eastW - gwcW;
          // Carve WC from the NE corner (corridor-side) of east column.
          placed.push(mkSpace('guest-wc',
            { x: eastX + diningW, y: publicRect.y + publicRect.h - gwcH, w: gwcW, h: gwcH },
            guestWc.placedLabel, guestWc.placedId, 'public'));
          placed.push(mkSpace('dining',
            { x: eastX, y: publicRect.y, w: diningW, h: publicRect.h },
            dining.placedLabel, dining.placedId, 'public'));
        } else {
          placed.push(mkSpace('dining',
            { x: eastX, y: publicRect.y, w: eastW, h: publicRect.h },
            dining.placedLabel, dining.placedId, 'public'));
        }
      } else {
        placed.push(mkSpace('living',
          { x: publicRect.x, y: publicRect.y, w: publicRect.w, h: publicRect.h },
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
      for (const t of ['dining','guest-wc','guest-room','family-room'] as SpaceType[]) {
        let s; while ((s = take(t))) publicSpecs.push(s);
      }
      publicSpecs.push(...publicUnplaced);
      placed.push(...splitBinary(publicRect, publicSpecs, mkSpace, 'public', 'y'));
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

  // --- Any unplaced specs (fallback): place in leftover area or ignore with note ---
  for (const [, list] of byType) {
    for (const s of list) {
      if (!['corridor','elevator-hall','stair-hall'].includes(s.type)) {
        // place in service nook or as overlap — validator will flag
      }
    }
  }

  snap(placed);
  // Ensure every placed room stays inside the outer bounds (corridor at 1/2 cm
  // drift can push outer rooms past the buildable footprint by 1cm).
  clampToBounds(placed, footprint);
  resolveOverlaps(placed);
  clampToBounds(placed, footprint);
  explanation.push(`Placed ${placed.length} rooms + ${corridors.length} corridor segment(s).`);
  return { spaces: placed, corridors, explanation };
}

/** Split a rectangle among specs recursively along the long axis; head
 *  (first after priority/area sort) takes the first slice sized to its
 *  fraction of target area. */
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
  const head = sorted[0]; const rest = sorted.slice(1);
  const total = sorted.reduce((s,r)=>s+Math.max(r.minArea,r.targetArea),0);
  let frac = Math.max(0.2, Math.min(0.65, Math.max(head.minArea,head.targetArea)/Math.max(total,1)));
  const restMin = Math.max(MIN_SIDE, ...rest.map(r => Math.max(r.minWidth ?? 1, r.minLength ?? 1)));
  const alongX = depth === 0 ? firstAxis === 'x' : (firstAxis === 'x' ? rect.w < rect.h : rect.w >= rect.h);

  if (alongX) {
    const at = Math.max(head.minWidth ?? MIN_SIDE, Math.min(rect.w - restMin - 0.05, rect.w * frac));
    const [l, r] = rSplitX(rect, Math.max(MIN_SIDE, at));
    return [...splitBinary(l, [head], mkSpace, zone, firstAxis, depth+1), ...splitBinary(r, rest, mkSpace, zone, firstAxis, depth+1)];
  } else {
    const minHead = Math.max(head.minWidth ?? MIN_SIDE, head.minLength ?? MIN_SIDE, Math.max(head.minArea,head.targetArea)/Math.max(rect.w,0.5));
    const at = Math.max(minHead, Math.min(rect.h - restMin - 0.05, rect.h * frac));
    const [b, t] = rSplitY(rect, Math.max(MIN_SIDE, at));
    return [...splitBinary(b, [head], mkSpace, zone, firstAxis, depth+1), ...splitBinary(t, rest, mkSpace, zone, firstAxis, depth+1)];
  }
}

function clampToBounds(list: Space[], bounds: Rect) {
  for (const s of list) {
    if (s.rect.x < bounds.x - 1e-6) s.rect.x = bounds.x;
    if (s.rect.y < bounds.y - 1e-6) s.rect.y = bounds.y;
    if (s.rect.x + s.rect.w > bounds.x + bounds.w + 1e-6) {
      s.rect.w = bounds.x + bounds.w - s.rect.x;
    }
    if (s.rect.y + s.rect.h > bounds.y + bounds.h + 1e-6) {
      s.rect.h = bounds.y + bounds.h - s.rect.y;
    }
    s.polygon = rCorners(s.rect); s.area = rArea(s.rect);
  }
}

function snap(list: Space[]) {
  for (const s of list) {
    s.rect.x = Math.round(s.rect.x*100)/100;
    s.rect.y = Math.round(s.rect.y*100)/100;
    s.rect.w = Math.round(s.rect.w*100)/100;
    s.rect.h = Math.round(s.rect.h*100)/100;
    s.polygon = rCorners(s.rect); s.area = rArea(s.rect);
  }
}
function resolveOverlaps(list: Space[]) {
  for (let iter = 0; iter < 4; iter++) {
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
}
