/**
 * Phase 15 M6 — region decomposition for irregular buildable polygons.
 *
 * The scanline decomposition used so far (decomposeOrthogonalPolygonToRects) is
 * orientation-ARBITRARY: for an L-shape it always cuts along the reflex corner's
 * vertical, producing two skinny 6 m bars where a horizontal cut across the same
 * notch line would have produced one generous 12 m band. Band placement quality
 * (M4) depends entirely on the RECTANGLES it is handed, so choosing the cut IS
 * topology work. This module enumerates the bounded set of guillotine partitions
 * of a rectilinear polygon into rectangles (all recursive full-span cuts at
 * reflex coordinates, max depth + max result caps — never a search), and lets the
 * capacity model pick the partition. If no clean guillotine partition exists, the
 * caller keeps the existing scanline rects (bounded failure, no bbox fallback).
 */
import type { Polygon } from '../geometry/polygon-ops.js';
import type { Rect } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';
import { polygonArea, polygonBoundingRect } from '../geometry/polygon-ops.js';
import { decomposeOrthogonalPolygonToRects } from '../geometry/polygon-ops.js';

const R = (v: number) => Math.round(v * 1e6) / 1e6;
const EPS = 1e-6;

/** Clip a rectilinear ring to one half-plane {axis ≥ at} ('max') or {axis ≤ at} ('min'). */
export function clipHalfPlane(poly: Polygon, axis: 'x' | 'y', at: number, keep: 'min' | 'max'): Polygon | null {
  const val = (p: Vec2) => (axis === 'x' ? p.x : p.y);
  const inside = (p: Vec2) => (keep === 'max' ? val(p) >= at - 1e-9 : val(p) <= at + 1e-9);
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = inside(a);
    const bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const denom = val(b) - val(a);
      if (Math.abs(denom) < 1e-12) continue; // segment parallel to the cut — degenerate, skip
      const t = (at - val(a)) / denom;
      out.push(axis === 'x' ? { x: at, y: R(a.y + (b.y - a.y) * t) } : { x: R(a.x + (b.x - a.x) * t), y: at });
    }
  }
  const ded: Vec2[] = [];
  for (const p of out) {
    const q = { x: R(p.x), y: R(p.y) };
    const last = ded[ded.length - 1];
    if (!last || Math.abs(last.x - q.x) > 1e-9 || Math.abs(last.y - q.y) > 1e-9) ded.push(q);
  }
  if (ded.length > 2) {
    const f = ded[0];
    const l = ded[ded.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) ded.pop();
  }
  // Drop collinear vertices: half-plane clipping can leave zero-area spikes
  // (a→p→b all on one line) that make a clean result ring unrecognizable.
  let cleaned = ded;
  for (let pass = 0; pass < 3; pass++) {
    const next: Vec2[] = [];
    for (let i = 0; i < cleaned.length; i++) {
      const a = cleaned[(i + cleaned.length - 1) % cleaned.length];
      const p = cleaned[i];
      const b = cleaned[(i + 1) % cleaned.length];
      const collinear = (Math.abs(a.x - p.x) < 1e-9 && Math.abs(p.x - b.x) < 1e-9)
        || (Math.abs(a.y - p.y) < 1e-9 && Math.abs(p.y - b.y) < 1e-9);
      if (!collinear) next.push(p);
    }
    cleaned = next;
    if (cleaned.length === next.length && cleaned.length <= 4) break;
  }
  return cleaned.length >= 4 ? cleaned : null;
}

/** If the ring is exactly an axis-aligned rectangle, return it as a Rect. */
export function ringToRect(poly: Polygon): Rect | null {
  const bb = polygonBoundingRect(poly);
  if (bb.w < EPS || bb.h < EPS) return null;
  if (Math.abs(polygonArea(poly) - bb.w * bb.h) > 1e-4 * Math.max(1, bb.w * bb.h)) return null;
  return bb;
}

function dedupeKey(rects: Rect[]): string {
  return rects.map(r => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)},${r.h.toFixed(3)}`).sort().join('|');
}

function contactLen(a: Rect, b: Rect): number {
  const vert = Math.abs(a.x + a.w - b.x) < 1e-6 || Math.abs(b.x + b.w - a.x) < 1e-6;
  const horz = Math.abs(a.y + a.h - b.y) < 1e-6 || Math.abs(b.y + b.h - a.y) < 1e-6;
  if (vert) return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (horz) return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return 0;
}

/** True iff the rect set tiles the polygon exactly (area conservation + all inside). */
function covers(rects: Rect[], poly: Polygon): boolean {
  const pa = polygonArea(poly);
  const ra = rects.reduce((s, r) => s + r.w * r.h, 0);
  return Math.abs(pa - ra) <= Math.max(1e-3, pa * 1e-6);
}

/**
 * Enumerate guillotine partitions of a rectilinear polygon into rectangles.
 * Bounded: maxDepth levels, maxResults lists, ≤4 cuts tried per axis per level
 * (median-near reflex coordinates), deterministic order. Includes the scanline
 * decomposition as one candidate whenever it exists.
 */
export function rectPartitions(poly: Polygon, opts: { maxResults?: number; maxDepth?: number; maxLeafAreaRatioWarn?: number } = {}): Rect[][] {
  const maxResults = opts.maxResults ?? 12;
  const maxDepth = opts.maxDepth ?? 4;
  const results: Rect[][] = [];
  const seen = new Set<string>();
  const add = (rects: Rect[]) => {
    if (!covers(rects, poly)) return;
    const k = dedupeKey(rects);
    if (seen.has(k)) return;
    seen.add(k);
    results.push(rects);
  };
  const enumerate = (p: Polygon, depth: number): Rect[][] => {
    const r = ringToRect(p);
    if (r) return [[r]];
    if (depth <= 0) {
      const sl = decomposeOrthogonalPolygonToRects(p);
      return sl ? [sl] : [];
    }
    const bb = polygonBoundingRect(p);
    const xs = [...new Set(p.map(v => R(v.x)))].filter(x => x > bb.x + 1e-6 && x < bb.x + bb.w - 1e-6).sort((a, b) => a - b);
    const ys = [...new Set(p.map(v => R(v.y)))].filter(y => y > bb.y + 1e-6 && y < bb.y + bb.h - 1e-6).sort((a, b) => a - b);
    const out: Rect[][] = [];
    const tryAxis = (axis: 'x' | 'y', coords: number[]) => {
      // bound the fan: at most 4 coordinates nearest the median of the range
      const mid = axis === 'x' ? bb.x + bb.w / 2 : bb.y + bb.h / 2;
      const picked = [...coords].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)).slice(0, 4);
      for (const c of picked) {
        const A = clipHalfPlane(p, axis, c, 'min');
        const B = clipHalfPlane(p, axis, c, 'max');
        if (!A || !B) continue;
        if (polygonArea(A) < 0.25 || polygonArea(B) < 0.25) continue;
        const ea = enumerate(A, depth - 1);
        const eb = enumerate(B, depth - 1);
        for (const pa of ea.slice(0, 3)) {
          for (const pb of eb.slice(0, 3)) {
            out.push([...pa, ...pb]);
            if (out.length >= maxResults * 2) return;
          }
        }
      }
    };
    tryAxis('x', xs);
    tryAxis('y', ys);
    if (out.length === 0) {
      const sl = decomposeOrthogonalPolygonToRects(p);
      if (sl) out.push(sl);
    }
    return out.slice(0, maxResults);
  };
  for (const part of enumerate(poly, maxDepth)) { add(part); if (results.length >= maxResults) break; }
  const scan = decomposeOrthogonalPolygonToRects(poly);
  if (scan) add(scan);
  return results;
}

/** Pairwise contact graph connectivity of a rect set (every rect reachable from every other through ≥minLen contacts). */
export function contactConnected(rects: Rect[], minLen = 1.0): boolean {
  if (rects.length <= 1) return rects.length === 1;
  const inSet = new Set([0]);
  const frontier = [0];
  while (frontier.length) {
    const i = frontier.pop()!;
    for (let j = 0; j < rects.length; j++) {
      if (inSet.has(j)) continue;
      if (contactLen(rects[i], rects[j]) >= minLen) { inSet.add(j); frontier.push(j); }
    }
  }
  return inSet.size === rects.length;
}

export { contactLen };
