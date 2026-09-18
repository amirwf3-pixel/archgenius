/**
 * Axis-aligned rectangle primitive (V1's primary room/footprint shape).
 * Defined by south-west corner `origin` and positive `width` (X, East) and
 * `height` (Y, North).
 */
import { EPS } from '../units.js';
import type { Vec2 } from './vec2.js';

export interface Rect {
  x: number; // min x  (SW corner)
  y: number; // min y  (SW corner)
  w: number; // width  (East)
  h: number; // height (North)
}

export const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const rOrigin = (r: Rect): Vec2 => ({ x: r.x, y: r.y });
export const rMinX = (r: Rect): number => r.x;
export const rMinY = (r: Rect): number => r.y;
export const rMaxX = (r: Rect): number => r.x + r.w;
export const rMaxY = (r: Rect): number => r.y + r.h;
export const rCenter = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rArea = (r: Rect): number => r.w * r.h;
export const rPerimeter = (r: Rect): number => 2 * (r.w + r.h);

export const rIsValid = (r: Rect, eps = EPS): boolean =>
  Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h) &&
  r.w > eps && r.h > eps;

export const rFromCorners = (x1: number, y1: number, x2: number, y2: number): Rect => {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.max(x1, x2) - x, h: Math.max(y1, y2) - y };
};

export const rContainsPoint = (r: Rect, p: Vec2, eps = EPS): boolean =>
  p.x >= r.x - eps && p.x <= r.x + r.w + eps &&
  p.y >= r.y - eps && p.y <= r.y + r.h + eps;

export const rContains = (outer: Rect, inner: Rect, eps = EPS): boolean =>
  inner.x >= outer.x - eps &&
  inner.y >= outer.y - eps &&
  inner.x + inner.w <= outer.x + outer.w + eps &&
  inner.y + inner.h <= outer.y + outer.h + eps;

export const rIntersects = (a: Rect, b: Rect, eps = EPS): boolean =>
  a.x < b.x + b.w + eps &&
  a.x + a.w > b.x - eps &&
  a.y < b.y + b.h + eps &&
  a.y + a.h > b.y - eps;

/** Returns the intersection rectangle, or null if disjoint. */
export const rIntersection = (a: Rect, b: Rect, eps = EPS): Rect | null => {
  if (!rIntersects(a, b, eps)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= eps || h <= eps) return null;
  return { x, y, w, h };
};

export const rOverlapArea = (a: Rect, b: Rect): number => {
  const inter = rIntersection(a, b);
  return inter ? rArea(inter) : 0;
};

/** Translate a rectangle. */
export const rTranslate = (r: Rect, dx: number, dy: number): Rect => ({
  x: r.x + dx,
  y: r.y + dy,
  w: r.w,
  h: r.h,
});

/** Offset (inset if positive amount) a rectangle on all sides. */
export const rInset = (r: Rect, amt: number): Rect => ({
  x: r.x + amt,
  y: r.y + amt,
  w: Math.max(0, r.w - 2 * amt),
  h: Math.max(0, r.h - 2 * amt),
});

/** Split a rectangle along the X axis at distance `at` from x-min. Returns [left, right]. */
export const rSplitX = (r: Rect, at: number): [Rect, Rect] => {
  const left: Rect = { x: r.x, y: r.y, w: at, h: r.h };
  const right: Rect = { x: r.x + at, y: r.y, w: r.w - at, h: r.h };
  return [left, right];
};

/** Split a rectangle along the Y axis at distance `at` from y-min. Returns [bottom, top]. */
export const rSplitY = (r: Rect, at: number): [Rect, Rect] => {
  const bottom: Rect = { x: r.x, y: r.y, w: r.w, h: at };
  const top: Rect = { x: r.x, y: r.y + at, w: r.w, h: r.h - at };
  return [bottom, top];
};

/** Rotated rectangle? No — V1 only supports axis-aligned rooms; rotation is for export. */

/** Return the four corners of a rect in order: SW, SE, NE, NW. */
export const rCorners = (r: Rect): [Vec2, Vec2, Vec2, Vec2] => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];

/** Return edges as (start, end) pairs: S, E, N, W. */
export const rEdges = (r: Rect): Array<[Vec2, Vec2]> => {
  const [sw, se, ne, nw] = rCorners(r);
  return [
    [sw, se],
    [se, ne],
    [ne, nw],
    [nw, sw],
  ];
};
