/**
 * Phase 11 — Site-aware validation with polygon canonical rooms
 */

import type { Finding } from './types.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import {
  rectInsidePolygon,
  pointInPolygon,
  validateSitePolygon,
} from '../geometry/polygon-ops.js';
import { rIntersects } from '../geometry/rect.js';
import { roomPolygonInsideBuildable } from '../geometry/room-polygon.js';

export function validateSite(candidate: LayoutCandidate): Finding[] {
  const findings: Finding[] = [];
  const anyCand = candidate as any;
  const siteBoundary: Polygon | undefined = anyCand.siteBoundary;
  const buildableBoundary: Polygon | undefined = anyCand.buildableBoundary;
  const buildableRects: Rect[] | undefined = anyCand.buildableRects;
  const siteShape: string | undefined = anyCand.siteShape;
  const siteArea: number | undefined = anyCand.siteAreaValue;
  const buildableArea: number | undefined = anyCand.buildableAreaValue;

  if (!siteBoundary || !buildableBoundary) {
    return findings;
  }

  const siteValidation = validateSitePolygon(siteBoundary, 8, 10);
  if (!siteValidation.valid) {
    for (const err of siteValidation.errors) {
      findings.push({
        code: 'SITE_INVALID_POLYGON',
        severity: 'hard',
        message: `Site polygon invalid: ${err} — shape ${siteShape}`,
        ruleId: 'SITE_GEOM',
        status: 'VERIFIED',
      });
    }
  }

  if (siteArea !== undefined && siteArea < 10) {
    findings.push({
      code: 'SITE_ZERO_AREA',
      severity: 'hard',
      message: `Site area too small ${siteArea.toFixed(1)} m² < 10 m²`,
      ruleId: 'SITE_GEOM',
      status: 'VERIFIED',
    });
  }

  if (buildableArea !== undefined && buildableArea < 5) {
    findings.push({
      code: 'SITE_INSUFFICIENT_BUILDABLE',
      severity: 'hard',
      message: `Insufficient buildable area ${buildableArea.toFixed(1)} m² < 5 m² after setbacks`,
      ruleId: 'SITE_GEOM',
      status: 'VERIFIED',
    });
  }

  for (const floor of candidate.floors) {
    for (const space of floor.spaces) {
      // Phase 11: check polygon canonical containment, not just bounding rect
      const polyInside = roomPolygonInsideBuildable(space.polygon, buildableBoundary, 1e-3);
      const rectInside = rectInsidePolygon(space.rect, buildableBoundary, 1e-3);
      if (!polyInside) {
        const code = space.type === 'corridor' ? 'SITE_CORRIDOR_OUTSIDE_BUILDABLE' : 'SITE_ROOM_OUTSIDE_BUILDABLE';
        findings.push({
          code,
          severity: 'hard',
          message: `${space.type === 'corridor' ? 'Corridor' : 'Room'} "${space.label}" polygon outside buildable boundary — site shape ${siteShape}, poly verts ${space.polygon.length}, area ${space.area.toFixed(1)} not inside buildable polygon`,
          ruleId: 'SITE_GEOM',
          entityIds: [space.id],
          bbox: [space.rect.x, space.rect.y, space.rect.x + space.rect.w, space.rect.y + space.rect.h],
          status: 'VERIFIED',
        });
      } else if (!rectInside) {
        // Bounding rect outside but polygon inside — for L-shaped rooms this can happen if bounding extends outside buildable but polygon does not
        // We still want to ensure bounding is not wildly outside, but for L-shaped rooms we allow rect outside if polygon inside
        // Only flag as advisory if shape is L-shaped or orthogonal
        if (space.shapeType === 'rectangle' || space.polygon.length === 4) {
          const code = space.type === 'corridor' ? 'SITE_CORRIDOR_OUTSIDE_BUILDABLE' : 'SITE_ROOM_OUTSIDE_BUILDABLE';
          findings.push({
            code,
            severity: 'hard',
            message: `${space.type === 'corridor' ? 'Corridor' : 'Room'} "${space.label}" bounding rect outside buildable — site shape ${siteShape}, rect ${space.rect.x.toFixed(1)},${space.rect.y.toFixed(1)} ${space.rect.w.toFixed(1)}x${space.rect.h.toFixed(1)} not inside buildable polygon`,
            ruleId: 'SITE_GEOM',
            entityIds: [space.id],
            bbox: [space.rect.x, space.rect.y, space.rect.x + space.rect.w, space.rect.y + space.rect.h],
            status: 'VERIFIED',
          });
        }
      }
    }

    for (const wall of floor.walls) {
      const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
      const startInside = pointInPolygon(wall.start, buildableBoundary, 1e-3);
      const endInside = pointInPolygon(wall.end, buildableBoundary, 1e-3);
      const midInside = pointInPolygon(mid, buildableBoundary, 1e-3);
      if (!startInside || !endInside || !midInside) {
        findings.push({
          code: 'SITE_WALL_OUTSIDE_BUILDABLE',
          severity: 'hard',
          message: `Wall ${wall.id} outside buildable boundary — startInside=${startInside} endInside=${endInside} midInside=${midInside} — site shape ${siteShape}`,
          ruleId: 'SITE_GEOM',
          entityIds: [wall.id],
          status: 'VERIFIED',
        });
      }
    }

    for (const opening of floor.openings) {
      const centerInside = pointInPolygon((opening as any).center, buildableBoundary, 1e-3);
      if (!centerInside) {
        findings.push({
          code: 'SITE_OPENING_OUTSIDE_BUILDABLE',
          severity: 'hard',
          message: `Opening ${opening.id} center outside buildable boundary — site shape ${siteShape}, center ${(opening as any).center.x.toFixed(1)},${(opening as any).center.y.toFixed(1)}`,
          ruleId: 'SITE_GEOM',
          entityIds: [opening.id],
          status: 'VERIFIED',
        });
      }
      const wall = floor.walls.find(w => w.id === (opening as any).wallId);
      if (wall) {
        const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
        if (!pointInPolygon(mid, buildableBoundary, 1e-3)) {
          findings.push({
            code: 'SITE_OPENING_HOST_WALL_OUTSIDE',
            severity: 'hard',
            message: `Opening ${opening.id} host wall ${wall.id} outside buildable — site shape ${siteShape}`,
            ruleId: 'SITE_GEOM',
            entityIds: [opening.id, wall.id],
            status: 'VERIFIED',
          });
        }
      }
    }

    const furniture = (floor as any).furniture as Array<{ id: string; rect: { x: number; y: number; w: number; h: number }; spaceId: string }> | undefined;
    if (furniture) {
      for (const furn of furniture) {
        if (!rectInsidePolygon(furn.rect as any, buildableBoundary, 1e-3)) {
          findings.push({
            code: 'SITE_FURNITURE_OUTSIDE_BUILDABLE',
            severity: 'hard',
            message: `Furniture ${furn.id} in space ${furn.spaceId} outside buildable boundary — site shape ${siteShape}`,
            ruleId: 'SITE_GEOM',
            entityIds: [furn.id, furn.spaceId],
            bbox: [furn.rect.x, furn.rect.y, furn.rect.x + furn.rect.w, furn.rect.y + furn.rect.h],
            status: 'VERIFIED',
          });
        }
        const hostSpace = floor.spaces.find(s => s.id === furn.spaceId);
        if (hostSpace) {
          const fr = furn.rect as any;
          const insidePoly = rectInsidePolygon(fr, hostSpace.polygon, 1e-3) || pointInPolygon({ x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 }, hostSpace.polygon, 1e-3);
          if (!insidePoly) {
            findings.push({
              code: 'SITE_FURNITURE_OUTSIDE_ROOM',
              severity: 'hard',
              message: `Furniture ${furn.id} outside its containing room ${hostSpace.label} polygon — site shape ${siteShape}`,
              ruleId: 'SITE_GEOM',
              entityIds: [furn.id, hostSpace.id],
              status: 'VERIFIED',
            });
          }
        }
      }
    }

    for (const stair of floor.stairs) {
      const foot = (stair as any).footprint ?? (stair as any).rect;
      if (foot && !rectInsidePolygon(foot, buildableBoundary, 1e-3)) {
        findings.push({
          code: 'SITE_STAIR_OUTSIDE_BUILDABLE',
          severity: 'hard',
          message: `Stair ${(stair as any).id} outside buildable boundary — site shape ${siteShape}`,
          ruleId: 'SITE_GEOM',
          entityIds: [(stair as any).id],
          bbox: [foot.x, foot.y, foot.x + foot.w, foot.y + foot.h],
          status: 'VERIFIED',
        });
      }
      const flights = (stair as any).flights as Array<{ footprint: { x: number; y: number; w: number; h: number } }> | undefined;
      if (flights) {
        for (const fl of flights) {
          if (fl.footprint && !rectInsidePolygon(fl.footprint as any, buildableBoundary, 1e-3)) {
            findings.push({
              code: 'SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE',
              severity: 'hard',
              message: `Stair flight ${fl.footprint} outside buildable — site shape ${siteShape}`,
              ruleId: 'SITE_GEOM',
              entityIds: [(stair as any).id],
              status: 'VERIFIED',
            });
          }
        }
      }
    }

    for (const stall of floor.parkingStalls) {
      if (!rectInsidePolygon(stall.rect, siteBoundary, 1e-3)) {
        findings.push({
          code: 'SITE_PARKING_OUTSIDE_SITE',
          severity: 'hard',
          message: `Parking stall ${stall.index} outside site boundary — site shape ${siteShape}`,
          ruleId: 'SITE_GEOM',
          entityIds: [stall.id],
          bbox: [stall.rect.x, stall.rect.y, stall.rect.x + stall.rect.w, stall.rect.y + stall.rect.h],
          status: 'VERIFIED',
        });
      }
      {
        // P16-A: the obstacle is the ACTUAL placed building footprint (space
        // rects, wall-inflated) — a stall on open ground inside the buildable
        // envelope is legal; only real building geometry may not be touched.
        // Raw space rects: a stall sharing the building edge line is legal
        // (stall row flush to the facade is the normal front-yard layout).
        const obstacleRects = floor.spaces.map(s => s.rect);
        for (const bf of obstacleRects) {
          if (rIntersects(stall.rect, bf, 1e-3)) {
            const ow = Math.min(stall.rect.x + stall.rect.w, bf.x + bf.w) - Math.max(stall.rect.x, bf.x);
            const oh = Math.min(stall.rect.y + stall.rect.h, bf.y + bf.h) - Math.max(stall.rect.y, bf.y);
            if (ow > 0.05 && oh > 0.05) {
              findings.push({
                code: 'SITE_PARKING_OVERLAPS_BUILDING',
                severity: 'hard',
                message: `Parking stall ${stall.index} overlaps building footprint — site-aware check`,
                ruleId: 'SITE_GEOM',
                entityIds: [stall.id],
                status: 'VERIFIED',
              });
            }
          }
        }
            }
    }
  }

  return findings;
}
