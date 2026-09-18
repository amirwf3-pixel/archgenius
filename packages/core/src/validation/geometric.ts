/**
 * Geometric validation rules.
 */
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { Finding } from './types.js';
import { rIntersects, rIntersection, rArea, rContains, rIsValid } from '../geometry/rect.js';
import { segmentsIntersect, closestPointOnSegment } from '../geometry/line.js';
import { EPS, ROOM_MIN_AREA, ROOM_MIN_SIDE } from '../units.js';
import type { Wall } from '../model/wall.js';
import { vDist } from '../geometry/vec2.js';

/** A crossing is "proper" if the segments intersect in their interiors
 *  (not at endpoints and not with an endpoint lying on the other segment
 *  within a generous wall-thickness epsilon). T-joints and corner joints
 *  are acceptable; X-crossings indicate genuine wall collisions. */
function properCrossing(w1: Wall, w2: Wall, eps: number): boolean {
  const { a: p1, b: p2 } = { a: w1.start, b: w1.end };
  const { a: p3, b: p4 } = { a: w2.start, b: w2.end };
  const isEnd = (p: any, a: any, b: any) => vDist(p, a) <= eps || vDist(p, b) <= eps;
  const onSeg = (p: any, a: any, b: any) => vDist(p, closestPointOnSegment(p, a, b)) <= eps;
  // If any endpoint of one wall lies on the other wall (and that endpoint
  // is not an endpoint of that other wall), it is a T-joint — acceptable.
  if (onSeg(p1, p3, p4) && !isEnd(p1, p3, p4)) return false;
  if (onSeg(p2, p3, p4) && !isEnd(p2, p3, p4)) return false;
  if (onSeg(p3, p1, p2) && !isEnd(p3, p1, p2)) return false;
  if (onSeg(p4, p1, p2) && !isEnd(p4, p1, p2)) return false;
  // Shared endpoints: accept.
  if (isEnd(p1, p3, p4) || isEnd(p2, p3, p4)) return false;
  if (isEnd(p3, p1, p2) || isEnd(p4, p1, p2)) return false;
  // Otherwise: require a true crossing.
  return !!segmentsIntersect({ a: p1, b: p2 }, { a: p3, b: p4 }, false);
}

export function validateGeometric(floor: Floor, footprintStrict = true): Finding[] {
  const findings: Finding[] = [];
  const spaces = floor.spaces;

  // Invalid rects / zero-area / tiny side
  for (const s of spaces) {
    if (!rIsValid(s.rect, EPS)) {
      findings.push(f('GEO_INVALID_DIMENSION', 'hard',
        `Space "${s.label}" has invalid dimensions (${s.rect.w.toFixed(2)} × ${s.rect.h.toFixed(2)} m).`,
        [s.id]));
      continue;
    }
    if (s.rect.w < ROOM_MIN_SIDE || s.rect.h < ROOM_MIN_SIDE) {
      findings.push(f('GEO_INVALID_DIMENSION', 'hard',
        `Space "${s.label}" is too narrow (${Math.min(s.rect.w, s.rect.h).toFixed(2)} m < ${ROOM_MIN_SIDE} m).`,
        [s.id], bbox(s)));
    }
    if (s.area < ROOM_MIN_AREA) {
      findings.push(f('GEO_ZERO_AREA_SPACE', 'hard',
        `Space "${s.label}" has near-zero area (${s.area.toFixed(2)} m²).`,
        [s.id], bbox(s)));
    }
    if (Math.abs(s.area - rArea(s.rect)) > 1e-3) {
      findings.push(f('GEO_INCONSISTENT_AREA', 'hard',
        `Space "${s.label}" area mismatch (polygon ${s.area.toFixed(2)} vs rect ${rArea(s.rect).toFixed(2)}).`,
        [s.id]));
    }
    if (footprintStrict && !rContains(floor.footprint, s.rect, 1e-3)) {
      findings.push(f('GEO_ROOM_OUTSIDE_FOOTPRINT', 'hard',
        `Space "${s.label}" extends outside the buildable footprint.`,
        [s.id], bbox(s)));
    }
  }

  // Pairwise overlap between spaces (HARD). Parking spaces overlap check
  // is relaxed because they are in their own zone, but we still check overlap
  // against parking stalls separately.
  const nonParking = spaces.filter(s => s.type !== 'parking');
  for (let i = 0; i < nonParking.length; i++) {
    for (let j = i + 1; j < nonParking.length; j++) {
      const a = nonParking[i], b = nonParking[j];
      if (rIntersects(a.rect, b.rect, 1e-3)) {
        const inter = rIntersection(a.rect, b.rect, 1e-3);
        const area = inter ? rArea(inter) : 0;
        if (area > 1e-3) {
          findings.push(f('GEO_OVERLAPPING_ROOMS', 'hard',
            `Overlap between "${a.label}" and "${b.label}" (${area.toFixed(2)} m²).`,
            [a.id, b.id], inter ? [inter.x, inter.y, inter.x + inter.w, inter.y + inter.h] : undefined));
        }
      }
    }
  }

  // Wall / wall segment proper-crossing (HARD). T-junctions (one endpoint
  // lying on the other segment, within epsilon) and shared endpoints are
  // legitimate construction joints. Only flag PROPER interior intersections.
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
