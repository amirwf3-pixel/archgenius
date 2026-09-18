/**
 * Phase 11 — Canonical Room Polygon Geometry
 *
 * Space.polygon is authoritative, Space.rect is derived bounding compatibility.
 * Supports:
 * - rectangle (4 verts)
 * - orthogonal L-shaped (6 verts)
 * - bounded orthogonal concave (up to 8 verts)
 *
 * All polygons are simple, orthogonal, CCW, deterministic, no silent bbox fallback.
 */

import type { Vec2 } from './vec2.js';
import type { Rect } from './rect.js';
import type { Polygon } from './polygon-ops.js';
import {
  polygonArea,
  polygonSignedArea,
  polygonBoundingRect,
  pointInPolygon,
  isOrthogonal,
  hasSelfIntersection,
  hasDuplicateConsecutiveVertices,
  hasZeroLengthEdges,
  rectInsidePolygon,
  pointOnPolygonBoundary,
} from './polygon-ops.js';
import { rArea, rCorners, rContains, rIntersects, rIntersection, R } from './rect.js';
import { EPS } from '../units.js';

export const ROOM_POLYGON_MAX_VERTS = 8;
export const ROOM_POLYGON_MIN_VERTS = 4;
export const ROOM_MIN_SIDE = 0.9; // m — aligned with units.ROOM_MIN_SIDE
export const ROOM_MIN_AREA = 1.0; // m² — aligned with units.ROOM_MIN_AREA

export type RoomShapeType = 'rectangle' | 'l-shape' | 'orthogonal';

export interface RoomPolygonMeta {
  shapeType: RoomShapeType;
  vertexCount: number;
  area: number;
  boundingRect: Rect;
  isOrthogonal: boolean;
  isSimple: boolean;
}

/**
 * Create rectangle polygon from rect (CCW: SW, SE, NE, NW)
 */
export function createRectangleRoomPolygon(rect: Rect): Polygon {
  const [sw, se, ne, nw] = rCorners(rect);
  return [sw, se, ne, nw];
}

/**
 * Create L-shaped room polygon from bounding rect and notch.
 * notchWidth, notchLength must be < bounding dimensions.
 * notchCorner: which corner of bounding rect is missing.
 */
export function createLShapedRoomPolygon(
  bounding: Rect,
  notchWidth: number,
  notchLength: number,
  notchCorner: 'ne' | 'nw' | 'se' | 'sw' = 'ne'
): Polygon | null {
  const eps = 1e-6;
  if (notchWidth <= eps || notchLength <= eps) return null;
  if (notchWidth >= bounding.w - eps || notchLength >= bounding.h - eps) return null;
  if (bounding.w < ROOM_MIN_SIDE || bounding.h < ROOM_MIN_SIDE) return null;

  const x0 = bounding.x;
  const y0 = bounding.y;
  const x1 = bounding.x + bounding.w;
  const y1 = bounding.y + bounding.h;
  let pts: Polygon;
  switch (notchCorner) {
    case 'ne':
      pts = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 - notchLength },
        { x: x1 - notchWidth, y: y1 - notchLength },
        { x: x1 - notchWidth, y: y1 },
        { x: x0, y: y1 },
      ];
      break;
    case 'nw':
      pts = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0 + notchWidth, y: y1 },
        { x: x0 + notchWidth, y: y1 - notchLength },
        { x: x0, y: y1 - notchLength },
      ];
      break;
    case 'se':
      pts = [
        { x: x0, y: y0 + notchLength },
        { x: x0 + bounding.w - notchWidth, y: y0 + notchLength },
        { x: x0 + bounding.w - notchWidth, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
      break;
    case 'sw':
      pts = [
        { x: x0 + notchWidth, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
        { x: x0, y: y0 + notchLength },
        { x: x0 + notchWidth, y: y0 + notchLength },
      ];
      break;
    default:
      return null;
  }
  // Ensure CCW
  if (polygonSignedArea(pts) < 0) pts = pts.slice().reverse();
  // Validate
  const v = validateRoomPolygon(pts);
  if (!v.valid) return null;
  return pts;
}

/**
 * Validate room polygon — orthogonal, simple, bounded verts, min area/side.
 */
export function validateRoomPolygon(poly: Polygon): { valid: boolean; errors: string[]; area: number; meta?: RoomPolygonMeta } {
  const errors: string[] = [];
  if (!poly || poly.length < ROOM_POLYGON_MIN_VERTS) {
    return { valid: false, errors: ['polygon must have at least 4 vertices'], area: 0 };
  }
  if (poly.length > ROOM_POLYGON_MAX_VERTS) {
    errors.push(`polygon exceeds maximum vertices ${ROOM_POLYGON_MAX_VERTS}, got ${poly.length}`);
  }
  if (hasDuplicateConsecutiveVertices(poly)) errors.push('duplicate consecutive vertices');
  if (hasZeroLengthEdges(poly)) errors.push('zero-length edges');
  const area = polygonArea(poly);
  if (area < ROOM_MIN_AREA - 1e-6) errors.push(`room area too small ${area.toFixed(2)} < ${ROOM_MIN_AREA}`);
  if (hasSelfIntersection(poly)) errors.push('self-intersecting polygon');
  if (!isOrthogonal(poly)) errors.push('non-orthogonal polygon — Phase 11 only supports orthogonal rooms');
  // Check min side length
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < ROOM_MIN_SIDE - 1e-6 && len > 1e-6) {
      // Allow small edges that are part of L-shape? But min side still enforced for room usability
      // We check bounding rect min side separately; here we just warn if any edge < min side but not fail hard unless < 0.5*min
      if (len < ROOM_MIN_SIDE * 0.5) errors.push(`edge too short ${len.toFixed(2)} < ${ROOM_MIN_SIDE * 0.5}`);
    }
  }
  const boundingRect = polygonBoundingRect(poly);
  if (boundingRect.w < ROOM_MIN_SIDE - 1e-6 || boundingRect.h < ROOM_MIN_SIDE - 1e-6) {
    errors.push(`bounding rect too narrow ${boundingRect.w.toFixed(2)}x${boundingRect.h.toFixed(2)} < ${ROOM_MIN_SIDE}`);
  }
  const valid = errors.length === 0;
  const shapeType: RoomShapeType = poly.length === 4 ? 'rectangle' : poly.length === 6 ? 'l-shape' : 'orthogonal';
  const meta: RoomPolygonMeta = {
    shapeType,
    vertexCount: poly.length,
    area,
    boundingRect,
    isOrthogonal: isOrthogonal(poly),
    isSimple: !hasSelfIntersection(poly),
  };
  return { valid, errors, area, meta };
}

/**
 * Derive bounding rect from polygon (compatibility)
 */
export function roomPolygonToBoundingRect(poly: Polygon): Rect {
  return polygonBoundingRect(poly);
}

/**
 * Area from polygon (canonical)
 */
export function roomPolygonArea(poly: Polygon): number {
  return polygonArea(poly);
}

/**
 * Centroid of polygon (for labels)
 */
export function roomPolygonCentroid(poly: Polygon): Vec2 {
  // Use area-weighted centroid
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const cross = p1.x * p2.y - p2.x * p1.y;
    a2 += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  const a = a2 * 3 || 1;
  return { x: cx / a, y: cy / a };
}

/**
 * Check if point is inside room polygon (canonical containment)
 */
export function roomContainsPoint(poly: Polygon, p: Vec2, eps = 1e-6): boolean {
  return pointInPolygon(p, poly, eps);
}

/**
 * Check if rect is inside room polygon
 */
export function roomContainsRect(poly: Polygon, rect: Rect, eps = 1e-3): boolean {
  return rectInsidePolygon(rect, poly, eps);
}

/**
 * Check if polygon A contains polygon B (all vertices of B inside A)
 */
export function roomContainsPolygon(outer: Polygon, inner: Polygon, eps = 1e-3): boolean {
  for (const v of inner) {
    if (!pointInPolygon(v, outer, eps) && !pointOnPolygonBoundary(v, outer, eps)) return false;
  }
  // Also check center of inner inside outer
  const centroid = roomPolygonCentroid(inner);
  if (!pointInPolygon(centroid, outer, eps)) return false;
  return true;
}

/**
 * Check if two room polygons overlap (intersection area > eps)
 * Touching at edge or corner is NOT overlap — only positive-area interior overlap counts.
 */
export function roomPolygonsOverlap(a: Polygon, b: Polygon, eps = 1e-3): boolean {
  // Quick bounding rect check — require positive-area intersection
  const ra = polygonBoundingRect(a);
  const rb = polygonBoundingRect(b);
  const inter = rIntersection(ra, rb, eps);
  if (!inter) return false; // disjoint or just touching
  if (inter.w <= eps || inter.h <= eps) return false;
  // Check strict interior: vertex strictly inside other (not on boundary)
  for (const v of a) {
    if (pointOnPolygonBoundary(v, b, eps)) continue;
    if (pointInPolygon(v, b, eps)) return true;
  }
  for (const v of b) {
    if (pointOnPolygonBoundary(v, a, eps)) continue;
    if (pointInPolygon(v, a, eps)) return true;
  }
  // Edge crossing that is not just touching or colinear shared wall
  for (let i = 0, n = a.length; i < n; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % n];
    for (let j = 0, m = b.length; j < m; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % m];
      if (isColinearOverlap(a1, a2, b1, b2, eps)) continue;
      if (segmentsIntersect(a1, a2, b1, b2, eps)) {
        // If intersection is only at shared endpoint on boundary, it's touching not overlap
        // Check mid-point of overlap region? For orthogonal crossing, positive intersection => overlap
        // Verify that intersection point is not just at endpoints that lie on other polygon boundary
        const crossIsBoundaryTouch =
          (pointOnPolygonBoundary(a1, b, eps) && pointOnPolygonBoundary(a2, b, eps)) ||
          (pointOnPolygonBoundary(b1, a, eps) && pointOnPolygonBoundary(b2, a, eps));
        if (crossIsBoundaryTouch) continue;
        return true;
      }
    }
  }
  // Additional check: center of bounding intersection inside both strictly
  const mid = { x: inter.x + inter.w / 2, y: inter.y + inter.h / 2 };
  if (!pointOnPolygonBoundary(mid, a, eps) && !pointOnPolygonBoundary(mid, b, eps)) {
    if (pointInPolygon(mid, a, eps) && pointInPolygon(mid, b, eps)) return true;
  }
  return false;
}

function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, eps = 1e-6): boolean {
  function orient(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  function onSeg(a: Vec2, b: Vec2, c: Vec2): boolean {
    return Math.min(a.x, c.x) - eps <= b.x && b.x <= Math.max(a.x, c.x) + eps &&
           Math.min(a.y, c.y) - eps <= b.y && b.y <= Math.max(a.y, c.y) + eps;
  }
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o1 === 0 && onSeg(p1, q1, p2)) return true;
  if (o2 === 0 && onSeg(p1, q2, p2)) return true;
  if (o3 === 0 && onSeg(q1, p1, q2)) return true;
  if (o4 === 0 && onSeg(q1, p2, q2)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function isColinearOverlap(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2, eps = 1e-6): boolean {
  const isHorizA = Math.abs(a1.y - a2.y) < eps;
  const isHorizB = Math.abs(b1.y - b2.y) < eps;
  const isVertA = Math.abs(a1.x - a2.x) < eps;
  const isVertB = Math.abs(b1.x - b2.x) < eps;
  if (isHorizA && isHorizB) {
    if (Math.abs(a1.y - b1.y) > eps) return false;
    const aMin = Math.min(a1.x, a2.x), aMax = Math.max(a1.x, a2.x);
    const bMin = Math.min(b1.x, b2.x), bMax = Math.max(b1.x, b2.x);
    return !(aMax <= bMin + eps || bMax <= aMin + eps);
  }
  if (isVertA && isVertB) {
    if (Math.abs(a1.x - b1.x) > eps) return false;
    const aMin = Math.min(a1.y, a2.y), aMax = Math.max(a1.y, a2.y);
    const bMin = Math.min(b1.y, b2.y), bMax = Math.max(b1.y, b2.y);
    return !(aMax <= bMin + eps || bMax <= aMin + eps);
  }
  return false;
}

/**
 * Get edges of polygon as [start, end] pairs
 */
export function getPolygonEdges(poly: Polygon): Array<[Vec2, Vec2]> {
  const edges: Array<[Vec2, Vec2]> = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    edges.push([poly[i], poly[(i + 1) % n]]);
  }
  return edges;
}

/**
 * Find shared wall edges between two polygons — returns overlapping segments
 */
export function sharedWallEdges(a: Polygon, b: Polygon, eps = 1e-6): Array<{ aEdge: [Vec2, Vec2]; bEdge: [Vec2, Vec2]; overlap: [Vec2, Vec2] }> {
  const result: Array<{ aEdge: [Vec2, Vec2]; bEdge: [Vec2, Vec2]; overlap: [Vec2, Vec2] }> = [];
  const edgesA = getPolygonEdges(a);
  const edgesB = getPolygonEdges(b);
  for (const ea of edgesA) {
    for (const eb of edgesB) {
      if (!isColinearOverlap(ea[0], ea[1], eb[0], eb[1], eps)) continue;
      // Compute overlap interval
      const isHoriz = Math.abs(ea[0].y - ea[1].y) < eps;
      if (isHoriz) {
        const y = ea[0].y;
        const aMin = Math.min(ea[0].x, ea[1].x), aMax = Math.max(ea[0].x, ea[1].x);
        const bMin = Math.min(eb[0].x, eb[1].x), bMax = Math.max(eb[0].x, eb[1].x);
        const oMin = Math.max(aMin, bMin), oMax = Math.min(aMax, bMax);
        if (oMax - oMin > eps) {
          result.push({ aEdge: ea, bEdge: eb, overlap: [{ x: oMin, y }, { x: oMax, y }] });
        }
      } else {
        const x = ea[0].x;
        const aMin = Math.min(ea[0].y, ea[1].y), aMax = Math.max(ea[0].y, ea[1].y);
        const bMin = Math.min(eb[0].y, eb[1].y), bMax = Math.max(eb[0].y, eb[1].y);
        const oMin = Math.max(aMin, bMin), oMax = Math.min(aMax, bMax);
        if (oMax - oMin > eps) {
          result.push({ aEdge: ea, bEdge: eb, overlap: [{ x, y: oMin }, { x, y: oMax }] });
        }
      }
    }
  }
  return result;
}

/**
 * Translate polygon by dx, dy
 */
export function translateRoomPolygon(poly: Polygon, dx: number, dy: number): Polygon {
  return poly.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Check if room polygon is inside buildable boundary polygon
 */
export function roomPolygonInsideBuildable(roomPoly: Polygon, buildableBoundary: Polygon, eps = 1e-3): boolean {
  for (const v of roomPoly) {
    if (!pointInPolygon(v, buildableBoundary, eps)) return false;
  }
  // Also check centroid inside
  const c = roomPolygonCentroid(roomPoly);
  if (!pointInPolygon(c, buildableBoundary, eps)) return false;
  // Check no edge crosses outside (midpoint of each edge inside)
  for (let i = 0, n = roomPoly.length; i < n; i++) {
    const a = roomPoly[i];
    const b = roomPoly[(i + 1) % n];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pointInPolygon(mid, buildableBoundary, eps)) return false;
  }
  return true;
}
