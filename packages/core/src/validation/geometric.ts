/**
 * Phase 11 — Geometric validation rules (polygon canonical)
 */

import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { Finding } from './types.js';
import { rIntersects, rIntersection, rArea, rContains, rIsValid } from '../geometry/rect.js';
import { segmentsIntersect, closestPointOnSegment } from '../geometry/line.js';
import { EPS, ROOM_MIN_AREA, ROOM_MIN_SIDE } from '../units.js';
import type { Wall } from '../model/wall.js';
import { vDist } from '../geometry/vec2.js';
import { polygonArea, polygonBoundingRect } from '../geometry/polygon-ops.js';
import { validateRoomPolygon, roomPolygonsOverlap, roomPolygonToBoundingRect } from '../geometry/room-polygon.js';

function properCrossing(w1: Wall, w2: Wall, eps: number): boolean {
  const { a: p1, b: p2 } = { a: w1.start, b: w1.end };
  const { a: p3, b: p4 } = { a: w2.start, b: w2.end };
  const isEnd = (p: any, a: any, b: any) => vDist(p, a) <= eps || vDist(p, b) <= eps;
  const onSeg = (p: any, a: any, b: any) => vDist(p, closestPointOnSegment(p, a, b)) <= eps;
  if (onSeg(p1, p3, p4) && !isEnd(p1, p3, p4)) return false;
  if (onSeg(p2, p3, p4) && !isEnd(p2, p3, p4)) return false;
  if (onSeg(p3, p1, p2) && !isEnd(p3, p1, p2)) return false;
  if (onSeg(p4, p1, p2) && !isEnd(p4, p1, p2)) return false;
  if (isEnd(p1, p3, p4) || isEnd(p2, p3, p4)) return false;
  if (isEnd(p3, p1, p2) || isEnd(p4, p1, p2)) return false;
  return !!segmentsIntersect({ a: p1, b: p2 }, { a: p3, b: p4 }, false);
}

export function validateGeometric(floor: Floor, footprintStrict = true): Finding[] {
  const findings: Finding[] = [];
  const spaces = floor.spaces;

  for (const s of spaces) {
    // Phase 11: polygon is canonical
    const poly = s.polygon;
    if (!poly || poly.length < 4) {
      findings.push(f('GEO_INVALID_DIMENSION', 'hard',
        `Space "${s.label}" has invalid polygon (verts ${poly?.length ?? 0}).`,
        [s.id]));
      continue;
    }

    // Validate polygon geometry
    const v = validateRoomPolygon(poly);
    if (!v.valid) {
      findings.push(f('GEO_INVALID_DIMENSION', 'hard',
        `Space "${s.label}" polygon invalid: ${v.errors.join('; ')}.`,
        [s.id], bbox(s)));
      continue;
    }

    // Check rect is bounding rect of polygon (compatibility)
    const bounding = polygonBoundingRect(poly);
    if (Math.abs(bounding.x - s.rect.x) > 1e-3 || Math.abs(bounding.y - s.rect.y) > 1e-3 ||
        Math.abs(bounding.w - s.rect.w) > 1e-3 || Math.abs(bounding.h - s.rect.h) > 1e-3) {
      findings.push(f('GEO_INCONSISTENT_RECT', 'soft',
        `Space "${s.label}" rect not equal to polygon bounding rect (canonical is polygon).`,
        [s.id]));
    }

    // Area must derive from polygon, not bounding rect (except rectangle where they equal)
    const polyArea = polygonArea(poly);
    if (Math.abs(s.area - polyArea) > 1e-3) {
      findings.push(f('GEO_INCONSISTENT_AREA', 'hard',
        `Space "${s.label}" area mismatch (stored ${s.area.toFixed(2)} vs polygon ${polyArea.toFixed(2)}).`,
        [s.id]));
    }

    // For rectangle shape, area should equal bounding rect area; for L-shape, area < bounding
    if (s.shapeType === 'rectangle' || poly.length === 4) {
      const rectArea = rArea(s.rect);
      if (Math.abs(polyArea - rectArea) > 1e-3) {
        findings.push(f('GEO_INCONSISTENT_AREA', 'hard',
          `Space "${s.label}" rectangle area mismatch (polygon ${polyArea.toFixed(2)} vs rect ${rectArea.toFixed(2)}).`,
          [s.id]));
      }
    }

    if (s.rect.w < ROOM_MIN_SIDE || s.rect.h < ROOM_MIN_SIDE) {
      findings.push(f('GEO_INVALID_DIMENSION', 'hard',
        `Space "${s.label}" bounding too narrow (${Math.min(s.rect.w, s.rect.h).toFixed(2)} m < ${ROOM_MIN_SIDE} m).`,
        [s.id], bbox(s)));
    }
    if (s.area < ROOM_MIN_AREA) {
      findings.push(f('GEO_ZERO_AREA_SPACE', 'hard',
        `Space "${s.label}" has near-zero area (${s.area.toFixed(2)} m²).`,
        [s.id], bbox(s)));
    }

    // Parametric constraints
    if (s.constraints) {
      if (s.constraints.minArea !== undefined && s.area < s.constraints.minArea - 1e-6) {
        findings.push(f('ROOM_CONSTRAINT_MIN_AREA', 'hard',
          `Space "${s.label}" area ${s.area.toFixed(2)} < minArea ${s.constraints.minArea}.`,
          [s.id]));
      }
      if (s.constraints.maxArea !== undefined && s.area > s.constraints.maxArea + 1e-6) {
        findings.push(f('ROOM_CONSTRAINT_MAX_AREA', 'hard',
          `Space "${s.label}" area ${s.area.toFixed(2)} > maxArea ${s.constraints.maxArea}.`,
          [s.id]));
      }
      if (s.constraints.minWidth !== undefined) {
        const minSide = Math.min(s.rect.w, s.rect.h);
        if (minSide < s.constraints.minWidth - 1e-6) {
          findings.push(f('ROOM_CONSTRAINT_MIN_WIDTH', 'hard',
            `Space "${s.label}" min side ${minSide.toFixed(2)} < minWidth ${s.constraints.minWidth}.`,
            [s.id]));
        }
      }
    }

    if (footprintStrict && !rContains(floor.footprint, s.rect, 1e-3)) {
      findings.push(f('GEO_ROOM_OUTSIDE_FOOTPRINT', 'hard',
        `Space "${s.label}" bounding extends outside the buildable footprint.`,
        [s.id], bbox(s)));
    }
  }

  // Pairwise overlap — use polygon overlap for accuracy, fallback to rect
  const nonParking = spaces.filter(s => s.type !== 'parking');
  for (let i = 0; i < nonParking.length; i++) {
    for (let j = i + 1; j < nonParking.length; j++) {
      const a = nonParking[i], b = nonParking[j];
      // Quick rect check
      if (!rIntersects(a.rect, b.rect, 1e-3)) continue;
      // Accurate polygon overlap
      if (roomPolygonsOverlap(a.polygon, b.polygon, 1e-3)) {
        // Compute overlap area via bounding rect intersection as approximation
        const inter = rIntersection(a.rect, b.rect, 1e-3);
        const area = inter ? rArea(inter) : 0;
        // For L-shape, rect overlap may be larger than actual polygon overlap, but we still flag if polygon overlap detected
        if (area > 1e-3 || a.polygon.length !== 4 || b.polygon.length !== 4) {
          findings.push(f('GEO_OVERLAPPING_ROOMS', 'hard',
            `Overlap between "${a.label}" and "${b.label}" (bounding overlap ${area.toFixed(2)} m², polygon overlap detected).`,
            [a.id, b.id], inter ? [inter.x, inter.y, inter.x + inter.w, inter.y + inter.h] : undefined));
        }
      }
    }
  }

  const walls = floor.walls;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const w1 = walls[i], w2 = walls[j];
      if (properCrossing(w1, w2, 1e-3)) {
        const hit = segmentsIntersect({ a: w1.start, b: w1.end }, { a: w2.start, b: w2.end }, true);
        findings.push(f('GEO_OVERLAPPING_WALLS', 'hard',
          `Walls ${w1.id} and ${w2.id} cross each other.`,
          [w1.id, w2.id], hit ? [hit.x - 0.05, hit.y - 0.05, hit.x + 0.05, hit.y + 0.05] : undefined));
      }
    }
  }

  return findings;
}

function f(code: Finding['code'], severity: Finding['severity'], message: string, entityIds?: string[], bbox?: Finding['bbox']): Finding {
  return { code, severity, message, entityIds, bbox };
}

function bbox(s: Space): [number, number, number, number] {
  return [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h];
}
