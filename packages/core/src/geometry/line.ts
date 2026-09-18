/**
 * Line-segment utilities.
 */
import type { Vec2 } from './vec2.js';
import { vSub, vCross, vDot, vAdd, vScale, vDist } from './vec2.js';
import { EPS } from '../units.js';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Closest point on segment AB to point P. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = vSub(b, a);
  const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1);
  const tc = Math.max(0, Math.min(1, t));
  return { x: a.x + ab.x * tc, y: a.y + ab.y * tc };
}

/** Distance from a point to a segment. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return vDist(p, closestPointOnSegment(p, a, b));
}

/** Orientation test. Returns -1/0/+1. */
export function orient(p: Vec2, q: Vec2, r: Vec2, eps = EPS): number {
  const c = vCross(vSub(q, p), vSub(r, p));
  if (Math.abs(c) <= eps) return 0;
  return c > 0 ? 1 : -1;
}

/**
 * Segment-segment intersection.
 * Returns the intersection point if segments cross, or null.
 * Treats endpoint-touching as intersection when `includeEndpoints` is true.
 */
export function segmentsIntersect(
  s1: Segment,
  s2: Segment,
  includeEndpoints = true,
  eps = EPS
): Vec2 | null {
  const { a: p1, b: p2 } = s1;
  const { a: p3, b: p4 } = s2;
  const r = vSub(p2, p1);
  const s = vSub(p4, p3);
  const denom = vCross(r, s);
  const p1p3 = vSub(p3, p1);
  if (Math.abs(denom) <= eps) {
    // Colinear or parallel
    if (Math.abs(vCross(p1p3, r)) > eps) return null;
    // Colinear — check parametric overlap
    const r2 = vDot(r, r);
    if (r2 < eps) return null;
    const t0 = vDot(p1p3, r) / r2;
    const t1 = t0 + vDot(s, r) / r2;
    const tmin = Math.min(t0, t1);
    const tmax = Math.max(t0, t1);
    if (tmax < -eps || tmin > 1 + eps) return null;
    const tc = Math.max(0, Math.min(1, (tmin + tmax) / 2));
    return vAdd(p1, vScale(r, tc));
  }
  const t = vCross(p1p3, s) / denom;
  const u = vCross(p1p3, r) / denom;
  if (includeEndpoints) {
    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  } else {
    if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  }
  return { x: p1.x + t * r.x, y: p1.y + t * r.y };
}
