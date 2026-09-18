/**
 * Polygon geometry primitives for Phase 10 Site/Context Intelligence
 * Supports orthogonal simple polygons up to 8 vertices, deterministic, no heavy lib.
 * All operations use EPS = 1e-6 m tolerance.
 */
import type { Vec2 } from './vec2.js';
import type { Rect } from './rect.js';
import { EPS } from '../units.js';
import { rCorners, rContainsPoint, rArea } from './rect.js';

export type Polygon = Vec2[];

const EPSP = 1e-6;

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}
function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

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
export function polygonOrientation(poly: Polygon): 'ccw' | 'cw' {
  return polygonSignedArea(poly) > 0 ? 'ccw' : 'cw';
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
export function polygonBoundingRect(poly: Polygon): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function hasDuplicateConsecutiveVertices(poly: Polygon, eps = EPSP): boolean {
  const n = poly.length;
  if (n < 2) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (dist2(a, b) <= eps * eps) return true;
  }
  return false;
}
export function hasZeroLengthEdges(poly: Polygon, eps = EPSP): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (dist(a, b) <= eps) return true;
  }
  return false;
}

function segIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, eps = EPSP): boolean {
  function orient(a: Vec2, b: Vec2, c: Vec2): number {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }
  function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
    return Math.min(a.x, c.x) - eps <= b.x && b.x <= Math.max(a.x, c.x) + eps &&
           Math.min(a.y, c.y) - eps <= b.y && b.y <= Math.max(a.y, c.y) + eps;
  }
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);

  if (o1 === 0 && onSegment(p1, q1, p2)) return true;
  if (o2 === 0 && onSegment(p1, q2, p2)) return true;
  if (o3 === 0 && onSegment(q1, p1, q2)) return true;
  if (o4 === 0 && onSegment(q1, p2, q2)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function hasSelfIntersection(poly: Polygon, eps = EPSP): boolean {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      if (j === 0 && i === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (dist2(a1, b1) <= eps * eps) continue;
      if (dist2(a1, b2) <= eps * eps) continue;
      if (dist2(a2, b1) <= eps * eps) continue;
      if (dist2(a2, b2) <= eps * eps) continue;
      if (segIntersect(a1, a2, b1, b2, eps)) return true;
    }
  }
  return false;
}

export function isOrthogonal(poly: Polygon, eps = 1e-3): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    if (dx > eps && dy > eps) return false;
  }
  return true;
}

export function pointOnSegment(p: Vec2, a: Vec2, b: Vec2, eps = EPSP): boolean {
  const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
  if (Math.abs(cross) > eps) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -eps) return false;
  const len2 = dist2(a, b);
  if (dot > len2 + eps) return false;
  return true;
}
export function pointOnPolygonBoundary(p: Vec2, poly: Polygon, eps = EPSP): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (pointOnSegment(p, a, b, eps)) return true;
  }
  return false;
}

/** Robust point-in-polygon using winding number, returns true if inside or on boundary */
export function pointInPolygon(p: Vec2, poly: Polygon, eps = EPSP): boolean {
  if (pointOnPolygonBoundary(p, poly, eps)) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / (yj - yi + (Math.abs(yj - yi) < eps ? eps : 0)) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const l2 = dist2(a, b);
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return dist(p, proj);
}
export function distanceToPolygonBoundary(p: Vec2, poly: Polygon): number {
  let min = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const d = distancePointToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

/** Check if axis-aligned rect is fully inside polygon */
export function rectInsidePolygon(rect: Rect, poly: Polygon, eps = EPSP): boolean {
  const corners = rCorners(rect);
  for (const c of corners) {
    if (!pointInPolygon(c, poly, eps)) return false;
  }
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  if (!pointInPolygon(center, poly, eps)) return false;

  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const rectEdges = [
      [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
      [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
      [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
      [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }],
    ] as Array<[Vec2, Vec2]>;
    for (const [r1, r2] of rectEdges) {
      if (segIntersect(a, b, r1, r2, eps)) {
        const mid = { x: (r1.x + r2.x) / 2, y: (r1.y + r2.y) / 2 };
        if (!pointInPolygon(mid, poly, eps)) {
          return false;
        }
      }
    }
  }
  return true;
}

export function polygonContainsRect(poly: Polygon, rect: Rect, eps = EPSP): boolean {
  return rectInsidePolygon(rect, poly, eps);
}

export function rectIntersectsPolygon(rect: Rect, poly: Polygon, eps = EPSP): boolean {
  const corners = rCorners(rect);
  for (const c of corners) {
    if (pointInPolygon(c, poly, eps)) return true;
  }
  for (const p of poly) {
    if (rContainsPoint(rect, p, eps)) return true;
  }
  const rectEdges = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }],
    [{ x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }],
    [{ x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }],
    [{ x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y }],
  ] as Array<[Vec2, Vec2]>;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (const [r1, r2] of rectEdges) {
      if (segIntersect(a, b, r1, r2, eps)) return true;
    }
  }
  return false;
}

/** Inset orthogonal polygon by directional setbacks. Returns new polygon or null if invalid/consumed. */
export function insetOrthogonalPolygon(
  poly: Polygon,
  setbacks: { north: number; south: number; east: number; west: number },
  eps = EPSP
): { polygon: Polygon; errors: string[] } | null {
  if (!isOrthogonal(poly)) {
    return null;
  }
  const n = poly.length;
  if (n < 4) return null;

  const orientation = polygonOrientation(poly);
  interface ShiftedEdge {
    origA: Vec2;
    origB: Vec2;
    isHorizontal: boolean;
    outward: 'north' | 'south' | 'east' | 'west';
    shift: number;
    newX?: number;
    newY?: number;
  }
  const edges: ShiftedEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const isHorizontal = Math.abs(dy) <= 1e-3;
    const isVertical = Math.abs(dx) <= 1e-3;
    if (!isHorizontal && !isVertical) return null;
    let outward: 'north' | 'south' | 'east' | 'west';
    if (orientation === 'ccw') {
      const rx = dy;
      const ry = -dx;
      if (Math.abs(rx) > Math.abs(ry)) {
        outward = rx > 0 ? 'east' : 'west';
      } else {
        outward = ry > 0 ? 'north' : 'south';
      }
    } else {
      const lx = -dy;
      const ly = dx;
      if (Math.abs(lx) > Math.abs(ly)) {
        outward = lx > 0 ? 'east' : 'west';
      } else {
        outward = ly > 0 ? 'north' : 'south';
      }
    }
    let shift = 0;
    switch (outward) {
      case 'north': shift = setbacks.north; break;
      case 'south': shift = setbacks.south; break;
      case 'east': shift = setbacks.east; break;
      case 'west': shift = setbacks.west; break;
    }
    edges.push({ origA: a, origB: b, isHorizontal, outward, shift });
  }

  for (const e of edges) {
    if (e.isHorizontal) {
      const y = e.origA.y;
      let newY = y;
      if (e.outward === 'north') newY = y - e.shift;
      else if (e.outward === 'south') newY = y + e.shift;
      e.newY = newY;
    } else {
      const x = e.origA.x;
      let newX = x;
      if (e.outward === 'east') newX = x - e.shift;
      else if (e.outward === 'west') newX = x + e.shift;
      e.newX = newX;
    }
  }

  const newPoly: Polygon = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    let x: number, y: number;
    if (prev.isHorizontal && !curr.isHorizontal) {
      x = curr.newX!;
      y = prev.newY!;
    } else if (!prev.isHorizontal && curr.isHorizontal) {
      x = prev.newX!;
      y = curr.newY!;
    } else {
      return null;
    }
    newPoly.push({ x, y });
  }

  const errors: string[] = [];
  if (hasDuplicateConsecutiveVertices(newPoly)) errors.push('inset resulted in duplicate vertices');
  if (hasZeroLengthEdges(newPoly)) errors.push('inset resulted in zero-length edges');
  const area = polygonArea(newPoly);
  if (area < 1e-6) {
    return { polygon: newPoly, errors: [...errors, 'insufficient buildable area after setbacks'] };
  }
  if (hasSelfIntersection(newPoly)) errors.push('inset resulted in self-intersection');

  for (const p of newPoly) {
    if (!pointInPolygon(p, poly, 1e-3)) {
      errors.push('inset polygon not contained within original site');
      break;
    }
  }

  if (errors.length > 0) {
    return { polygon: newPoly, errors };
  }

  return { polygon: newPoly, errors: [] };
}

/**
 * Deterministic orthogonal polygon decomposition into rectangles.
 * Supports rectangle (4 verts) → 1 rect, L-shape (6 verts) → 2 rects, orthogonal 8-vert → up to 6 rects via scanline.
 * Returns null if decomposition fails safely (no silent bounding-rect fallback).
 * Bounded: xs ≤8, slabs ≤7, intervals ≤4, total rects ≤~12, no combinatorial explosion.
 */
export function decomposeOrthogonalPolygonToRects(poly: Polygon): Rect[] | null {
  const eps = 1e-6;
  if (!poly || poly.length < 4) return null;
  if (!isOrthogonal(poly)) return null;
  if (poly.length === 4) {
    const br = polygonBoundingRect(poly);
    if (br.w < eps || br.h < eps) return null;
    return [br];
  }

  // For L-shape 6 verts, use dedicated missing-corner logic
  if (poly.length === 6) {
    const concaveIdx = findConcaveVertex(poly);
    if (concaveIdx !== -1) {
      const concave = poly[concaveIdx];
      const br = polygonBoundingRect(poly);
      const corners = [
        { x: br.x, y: br.y, corner: 'sw' as const },
        { x: br.x + br.w, y: br.y, corner: 'se' as const },
        { x: br.x + br.w, y: br.y + br.h, corner: 'ne' as const },
        { x: br.x, y: br.y + br.h, corner: 'nw' as const },
      ];
      let missingCorner: 'sw' | 'se' | 'ne' | 'nw' | null = null;
      for (const c of corners) {
        if (!pointInPolygon(c, poly, 1e-3)) {
          missingCorner = c.corner;
          break;
        }
      }
      if (missingCorner) {
        if (missingCorner === 'ne') {
          const rectA: Rect = { x: br.x, y: br.y, w: concave.x - br.x, h: br.h };
          const rectB: Rect = { x: concave.x, y: br.y, w: br.x + br.w - concave.x, h: concave.y - br.y };
          const rects = [rectA, rectB].filter(r => r.w > 1e-3 && r.h > 1e-3);
          if (rects.length === 2) {
            const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
            const area = polygonArea(poly);
            if (Math.abs(sum - area) < 1e-3 * area + 1e-6) return rects;
          }
        } else if (missingCorner === 'nw') {
          const rectA: Rect = { x: concave.x, y: br.y, w: br.x + br.w - concave.x, h: br.h };
          const rectB: Rect = { x: br.x, y: br.y, w: concave.x - br.x, h: concave.y - br.y };
          const rects = [rectA, rectB].filter(r => r.w > 1e-3 && r.h > 1e-3);
          if (rects.length === 2) {
            const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
            const area = polygonArea(poly);
            if (Math.abs(sum - area) < 1e-3 * area + 1e-6) return rects;
          }
        } else if (missingCorner === 'se') {
          const rectA2: Rect = { x: br.x, y: concave.y, w: br.w, h: br.y + br.h - concave.y };
          const rectB2: Rect = { x: br.x, y: br.y, w: concave.x - br.x, h: concave.y - br.y };
          const rects = [rectA2, rectB2].filter(r => r.w > 1e-3 && r.h > 1e-3);
          if (rects.length === 2) {
            const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
            const area = polygonArea(poly);
            if (Math.abs(sum - area) < 1e-3 * area + 1e-6) return rects;
          }
        } else {
          const rectA2: Rect = { x: br.x, y: concave.y, w: br.w, h: br.y + br.h - concave.y };
          const rectB2: Rect = { x: concave.x, y: br.y, w: br.x + br.w - concave.x, h: concave.y - br.y };
          const rects = [rectA2, rectB2].filter(r => r.w > 1e-3 && r.h > 1e-3);
          if (rects.length === 2) {
            const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
            const area = polygonArea(poly);
            if (Math.abs(sum - area) < 1e-3 * area + 1e-6) return rects;
          }
        }
      }
    }
    // Fall through to scanline for 6-vert if dedicated fails
  }

  // General orthogonal decomposition via vertical scanline
  const xsRaw = Array.from(new Set(poly.map(p => Math.round(p.x * 1e6) / 1e6))).sort((a, b) => a - b);
  const xsDedup: number[] = [];
  for (const x of xsRaw) {
    if (xsDedup.length === 0 || Math.abs(x - xsDedup[xsDedup.length - 1]) > 1e-6) xsDedup.push(x);
  }
  if (xsDedup.length < 2) return null;

  const rects: Rect[] = [];

  for (let i = 0; i < xsDedup.length - 1; i++) {
    const x0 = xsDedup[i];
    const x1 = xsDedup[i + 1];
    const w = x1 - x0;
    if (w < 1e-6) continue;
    const midX = (x0 + x1) / 2;

    const yInts: number[] = [];
    for (let j = 0, n = poly.length; j < n; j++) {
      const a = poly[j];
      const b = poly[(j + 1) % n];
      const isHorizontal = Math.abs(a.y - b.y) < 1e-6;
      if (!isHorizontal) continue;
      const minX = Math.min(a.x, b.x) - 1e-9;
      const maxX = Math.max(a.x, b.x) + 1e-9;
      if (midX >= minX && midX <= maxX) {
        yInts.push(a.y);
      }
    }
    if (yInts.length === 0) continue;
    yInts.sort((a, b) => a - b);
    const yDedup: number[] = [];
    for (const y of yInts) {
      if (yDedup.length === 0 || Math.abs(y - yDedup[yDedup.length - 1]) > 1e-6) yDedup.push(y);
    }
    if (yDedup.length % 2 !== 0) {
      return null; // odd intersections → not simple orthogonal slice
    }
    for (let k = 0; k < yDedup.length; k += 2) {
      const y0 = yDedup[k];
      const y1 = yDedup[k + 1];
      const h = y1 - y0;
      if (h < 1e-6) continue;
      const midY = (y0 + y1) / 2;
      if (!pointInPolygon({ x: midX, y: midY }, poly, 1e-3)) continue;
      rects.push({ x: x0, y: y0, w, h });
    }
  }

  if (rects.length === 0) return null;

  const polyArea = polygonArea(poly);
  let sumArea = 0;
  for (const r of rects) {
    if (!rectInsidePolygon(r, poly, 1e-3)) {
      return null;
    }
    sumArea += r.w * r.h;
  }
  if (Math.abs(sumArea - polyArea) > 1e-2 + 1e-3 * polyArea) {
    return null;
  }

  const merged = mergeRectsDeterministic(rects);
  return merged;
}

function mergeRectsDeterministic(rects: Rect[]): Rect[] {
  let current = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  let changed = true;
  while (changed) {
    changed = false;
    const next: Rect[] = [];
    const used = new Array(current.length).fill(false);
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      let r = current[i];
      for (let j = i + 1; j < current.length; j++) {
        if (used[j]) continue;
        const o = current[j];
        if (Math.abs(r.y - o.y) < 1e-6 && Math.abs(r.h - o.h) < 1e-6) {
          if (Math.abs(r.x + r.w - o.x) < 1e-6) {
            r = { x: r.x, y: r.y, w: r.w + o.w, h: r.h };
            used[j] = true;
            changed = true;
          } else if (Math.abs(o.x + o.w - r.x) < 1e-6) {
            r = { x: o.x, y: r.y, w: r.w + o.w, h: r.h };
            used[j] = true;
            changed = true;
          }
        }
      }
      next.push(r);
      used[i] = true;
    }
    current = next.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  changed = true;
  while (changed) {
    changed = false;
    const next: Rect[] = [];
    const used = new Array(current.length).fill(false);
    for (let i = 0; i < current.length; i++) {
      if (used[i]) continue;
      let r = current[i];
      for (let j = i + 1; j < current.length; j++) {
        if (used[j]) continue;
        const o = current[j];
        if (Math.abs(r.x - o.x) < 1e-6 && Math.abs(r.w - o.w) < 1e-6) {
          if (Math.abs(r.y + r.h - o.y) < 1e-6) {
            r = { x: r.x, y: r.y, w: r.w, h: r.h + o.h };
            used[j] = true;
            changed = true;
          } else if (Math.abs(o.y + o.h - r.y) < 1e-6) {
            r = { x: r.x, y: o.y, w: r.w, h: r.h + o.h };
            used[j] = true;
            changed = true;
          }
        }
      }
      next.push(r);
      used[i] = true;
    }
    current = next.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  current.sort((a, b) => (b.w * b.h) - (a.w * a.h) || a.y - b.y || a.x - b.x);
  return current;
}

function findConcaveVertex(poly: Polygon): number {
  const n = poly.length;
  const orient = polygonOrientation(poly);
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const cross = v1x * v2y - v1y * v2x;
    if (orient === 'ccw' && cross < -1e-6) return i;
    if (orient === 'cw' && cross > 1e-6) return i;
  }
  return -1;
}

/** Create L-shape polygon from overall width/length and notch */
export function createLShapePolygon(
  width: number,
  length: number,
  notchWidth: number,
  notchLength: number,
  corner: 'ne' | 'nw' | 'se' | 'sw' | 'north-east' | 'north-west' | 'south-east' | 'south-west',
  originX = 0,
  originY = 0
): Polygon {
  const W = width;
  const L = length;
  const nW = notchWidth;
  const nL = notchLength;
  const norm = (() => {
    const map: Record<string, string> = { 'north-east': 'ne', 'north-west': 'nw', 'south-east': 'se', 'south-west': 'sw', 'ne': 'ne', 'nw': 'nw', 'se': 'se', 'sw': 'sw' };
    return (map[corner] ?? corner) as 'ne' | 'nw' | 'se' | 'sw';
  })();
  let pts: Polygon;
  switch (norm) {
    case 'ne':
      pts = [
        { x: originX, y: originY },
        { x: originX + W, y: originY },
        { x: originX + W, y: originY + L - nL },
        { x: originX + W - nW, y: originY + L - nL },
        { x: originX + W - nW, y: originY + L },
        { x: originX, y: originY + L },
      ];
      break;
    case 'nw':
      pts = [
        { x: originX, y: originY },
        { x: originX + W, y: originY },
        { x: originX + W, y: originY + L },
        { x: originX + nW, y: originY + L },
        { x: originX + nW, y: originY + L - nL },
        { x: originX, y: originY + L - nL },
      ];
      break;
    case 'se':
      pts = [
        { x: originX, y: originY + nL },
        { x: originX + W - nW, y: originY + nL },
        { x: originX + W - nW, y: originY },
        { x: originX + W, y: originY },
        { x: originX + W, y: originY + L },
        { x: originX, y: originY + L },
      ];
      break;
    case 'sw':
      pts = [
        { x: originX + nW, y: originY },
        { x: originX + W, y: originY },
        { x: originX + W, y: originY + L },
        { x: originX, y: originY + L },
        { x: originX, y: originY + nL },
        { x: originX + nW, y: originY + nL },
      ];
      break;
    default:
      pts = [
        { x: originX, y: originY },
        { x: originX + W, y: originY },
        { x: originX + W, y: originY + L },
        { x: originX, y: originY + L },
      ];
  }
  if (polygonSignedArea(pts) < 0) pts = pts.reverse();
  return pts;
}

/** Validate site polygon — returns errors, area, etc */
export function validateSitePolygon(poly: Polygon, maxVerts = 8, minArea = 10): { valid: boolean; isValid: boolean; errors: string[]; area: number } {
  const errors: string[] = [];
  if (!poly || poly.length < 3) {
    return { valid: false, isValid: false, errors: ['polygon must have at least 3 vertices'], area: 0 };
  }
  if (poly.length > maxVerts) {
    errors.push(`polygon exceeds maximum vertices ${maxVerts}, got ${poly.length}`);
  }
  if (hasDuplicateConsecutiveVertices(poly)) errors.push('duplicate consecutive vertices');
  if (hasZeroLengthEdges(poly)) errors.push('zero-length edges');
  const area = polygonArea(poly);
  if (area < minArea) errors.push(`zero-area or too small site area ${area.toFixed(2)} < ${minArea}`);
  if (hasSelfIntersection(poly)) errors.push('self-intersecting polygon');
  if (!isOrthogonal(poly)) {
    errors.push('non-orthogonal polygon — V1 only supports orthogonal (axis-aligned) polygons');
  }
  const valid = errors.length === 0;
  return { valid, isValid: valid, errors, area };
}
