import { describe, it, expect } from 'vitest';
import { R, rArea, rIntersects, rIntersection, rSplitX, rSplitY, rContains, rInset } from './rect.js';

describe('Rect primitives', () => {
  it('computes area correctly', () => {
    expect(rArea(R(0, 0, 4, 3))).toBe(12);
  });
  it('detects overlap', () => {
    expect(rIntersects(R(0, 0, 2, 2), R(1, 1, 2, 2))).toBe(true);
    expect(rIntersects(R(0, 0, 1, 1), R(2, 2, 1, 1))).toBe(false);
  });
  it('computes intersection', () => {
    const i = rIntersection(R(0, 0, 3, 3), R(2, 2, 3, 3));
    expect(i).toBeTruthy();
    if (i) {
      expect(i.w).toBeCloseTo(1);
      expect(i.h).toBeCloseTo(1);
    }
  });
  it('splits along X and Y', () => {
    const [a, b] = rSplitX(R(0, 0, 10, 4), 4);
    expect(a.w).toBe(4); expect(b.w).toBe(6);
    const [c, d] = rSplitY(R(0, 0, 10, 4), 1.5);
    expect(c.h).toBe(1.5); expect(d.h).toBe(2.5);
  });
  it('contains and inset', () => {
    const outer = R(0, 0, 10, 10);
    const inner = R(1, 1, 2, 2);
    expect(rContains(outer, inner)).toBe(true);
    expect(rContains(outer, R(-1, -1, 2, 2))).toBe(false);
    const ins = rInset(outer, 1);
    expect(ins.x).toBe(1); expect(ins.y).toBe(1); expect(ins.w).toBe(8); expect(ins.h).toBe(8);
  });
});
