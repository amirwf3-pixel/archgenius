/**
 * Deterministic slicing layout engine.
 */
import type { Rect } from '../geometry/rect.js';
import { rSplitX, rSplitY } from '../geometry/rect.js';

export interface Band {
  rect: Rect;
  axis: 'h' | 'v';
  rooms: BandSlot[];
}

export interface BandSlot {
  rect: Rect;
  weight: number;
}

/** Split a rect into N weighted sub-rects along X axis. */
export function splitWeightedX(r: Rect, weights: number[]): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: Rect[] = [];
  let x = r.x;
  for (let i = 0; i < weights.length; i++) {
    const w = (weights[i] / total) * r.w;
    if (i === weights.length - 1) {
      out.push({ x, y: r.y, w: r.x + r.w - x, h: r.h });
    } else {
      out.push({ x, y: r.y, w, h: r.h });
      x += w;
    }
  }
  return out;
}

/** Split a rect into N weighted sub-rects along Y axis. */
export function splitWeightedY(r: Rect, weights: number[]): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out: Rect[] = [];
  let y = r.y;
  for (let i = 0; i < weights.length; i++) {
    const h = (weights[i] / total) * r.h;
    if (i === weights.length - 1) {
      out.push({ x: r.x, y, w: r.w, h: r.y + r.h - y });
    } else {
      out.push({ x: r.x, y, w: r.w, h });
      y += h;
    }
  }
  return out;
}

/** Slice a fixed-depth strip off one side of a rect. Returns [strip, remainder]. */
export function sliceStrip(r: Rect, side: 'north' | 'south' | 'east' | 'west', depth: number): [Rect, Rect] {
  switch (side) {
    case 'west': {
      const [a, b] = rSplitX(r, Math.min(depth, r.w * 0.5));
      return [a, b];
    }
    case 'east': {
      const [a, b] = rSplitX(r, Math.max(r.w - depth, r.w * 0.5));
      return [b, a];
    }
    case 'south': {
      const [a, b] = rSplitY(r, Math.min(depth, r.h * 0.5));
      return [a, b];
    }
    case 'north': {
      const [a, b] = rSplitY(r, Math.max(r.h - depth, r.h * 0.5));
      return [b, a];
    }
  }
}
