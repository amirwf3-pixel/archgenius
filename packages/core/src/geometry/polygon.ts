/**
 * Simple (non self-intersecting) polygon utilities. In V1 we use
 * axis-aligned rectangles almost everywhere; Polygon is a ccw closed ring
 * used for rooms that may become L-shaped in later phases.
 */
import type { Vec2 } from './vec2.js';
import { EPS } from '../units.js';

export type Polygon = Vec2[];

/** Signed area (positive if CCW). */
export function polygonSignedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return a / 2;
}

export function polygonArea(poly: Polygon): number {
  return Math.abs(polygonSignedArea(poly));
}

export function polygonCentroid(poly: Polygon): Vec2 {
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

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Vec2, poly: Polygon, eps = EPS): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const dy = yj - yi;
    if (Math.abs(dy) <= eps) continue;
    const onEdge = (yi > p.y) !== (yj > p.y);
    const xIntersect = ((xj - xi) * (p.y - yi)) / dy + xi;
    if (onEdge && p.x < xIntersect - eps) inside = !inside;
  }
  return inside;
}
