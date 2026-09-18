/**
 * Phase 10 — Site-aware validation
 * Detects invalid site polygon, self-intersection, zero-area, room outside buildable, stair outside, parking outside, setback violations, insufficient buildable area
 */

import type { Finding } from './types.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import {
  rectInsidePolygon,
  pointInPolygon,
  polygonArea,
  hasSelfIntersection,
  hasDuplicateConsecutiveVertices,
  hasZeroLengthEdges,
  validateSitePolygon,
} from '../geometry/polygon-ops.js';
import { rIntersects } from '../geometry/rect.js';

export function validateSite(candidate: LayoutCandidate): Finding[] {
  const findings: Finding[] = [];
  const anyCand = candidate as any;
  const siteBoundary: Polygon | undefined = anyCand.siteBoundary;
  const buildableBoundary: Polygon | undefined = anyCand.buildableBoundary;
  const buildableRects: Rect[] | undefined = anyCand.buildableRects;
  const siteShape: string | undefined = anyCand.siteShape;
  const siteArea: number | undefined = anyCand.siteAreaValue;
  const buildableArea: number | undefined = anyCand.buildableAreaValue;

  // If no site info (old rectangle path), skip site validation (backward compat)
  if (!siteBoundary || !buildableBoundary) {
    return findings;
  }

  // Validate site polygon
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

  // Check each floor — complete containment per Phase 10.1
  for (const floor of candidate.floors) {
    // Rooms + corridors / circulation — HARD if outside buildable
    for (const space of floor.spaces) {
      // All spaces including corridors must be inside buildableBoundary
      if (!rectInsidePolygon(space.rect, buildableBoundary, 1e-3)) {
        const code = space.type === 'corridor' ? 'SITE_CORRIDOR_OUTSIDE_BUILDABLE' : 'SITE_ROOM_OUTSIDE_BUILDABLE';
        findings.push({
          code,
          severity: 'hard',
          message: `${space.type === 'corridor' ? 'Corridor' : 'Room'} "${space.label}" outside buildable boundary — site shape ${siteShape}, rect ${space.rect.x.toFixed(1)},${space.rect.y.toFixed(1)} ${space.rect.w.toFixed(1)}x${space.rect.h.toFixed(1)} not inside buildable polygon`,
          ruleId: 'SITE_GEOM',
          entityIds: [space.id],
          bbox: [space.rect.x, space.rect.y, space.rect.x + space.rect.w, space.rect.y + space.rect.h],
          status: 'VERIFIED',
        });
      }
    }

    // Walls — HARD where applicable: check start, end, and midpoint inside buildable
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

    // Openings — HARD: center must be inside buildable, and host wall must be inside
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
      // Check host wall containment
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

    // Furniture — HARD: must be inside containing room and inside buildable
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
          // Furniture should be inside host room rect (with small tolerance)
          const fr = furn.rect as any;
          const sr = hostSpace.rect;
          const insideRoom = fr.x >= sr.x - 1e-3 && fr.y >= sr.y - 1e-3 && fr.x + fr.w <= sr.x + sr.w + 1e-3 && fr.y + fr.h <= sr.y + sr.h + 1e-3;
          if (!insideRoom) {
            findings.push({
              code: 'SITE_FURNITURE_OUTSIDE_ROOM',
              severity: 'hard',
              message: `Furniture ${furn.id} outside its containing room ${hostSpace.label} — site shape ${siteShape}`,
              ruleId: 'SITE_GEOM',
              entityIds: [furn.id, hostSpace.id],
              status: 'VERIFIED',
            });
          }
        }
      }
    }

    // Stair outside buildable — HARD (existing)
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
      // Also check flights/landings inside buildable if present
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

    // Parking outside permitted geometry (site boundary) — HARD
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
      // Parking should not overlap building footprint (buildableRects are building footprint canonical, not bounding)
      if (buildableRects && buildableRects.length > 0) {
        for (const bf of buildableRects) {
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
      } else {
        // If buildableRects empty (decomposition failure), check if stall center inside buildableBoundary (building footprint)
        const center = { x: stall.rect.x + stall.rect.w / 2, y: stall.rect.y + stall.rect.h / 2 };
        if (pointInPolygon(center, buildableBoundary, 1e-3) || rectInsidePolygon(stall.rect, buildableBoundary, 1e-3)) {
          findings.push({
            code: 'SITE_PARKING_OVERLAPS_BUILDING',
            severity: 'hard',
            message: `Parking stall ${stall.index} overlaps building footprint (buildableBoundary) — site-aware check, buildableRects empty due to decomposition failure`,
            ruleId: 'SITE_GEOM',
            entityIds: [stall.id],
            status: 'VERIFIED',
          });
        }
      }
    }
  }

  return findings;
}
