/**
 * placeParkingSiteAware offset loop: `offEnd` already reserves the band depth
 * (off + bandTotal <= dMax), so the loop bound must be `off <= offEnd`. The old
 * bound `off + bandTotal <= offEnd` subtracted the band depth twice and skipped
 * every offset of a band deeper than half the depth axis — e.g. every
 * perpendicular band (3.5 m aisle + 5 m stall) on the 12×18 lot's 16.5 m axis.
 */
import { describe, it, expect } from 'vitest';
import { placeParkingSiteAware, type ParkingSiteAwareInput } from './parking.js';
import { PARKING_STALL_WIDTH, PARKING_STALL_LENGTH } from '../units.js';
import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon-ops.js';

const E = 1e-6;
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const rectPoly = (w: number, l: number): Polygon => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }] as Polygon;
const overlap = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.02 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.02;
const inside = (r: Rect, o: Rect) => r.x >= o.x - E && r.y >= o.y - E && r.x + r.w <= o.x + o.w + E && r.y + r.h <= o.y + o.h + E;

// 12×18 lot, south access, setbacks N1.5 S3 E1.5 W1.5 → buildable x 1.5–10.5, y 3–16.5.
const BUILDABLE = R(1.5, 3, 9, 13.5);
const HOUSE = R(1.5, 8.5, 9, 8);
const input = (over: Partial<ParkingSiteAwareInput> = {}): ParkingSiteAwareInput => ({
  siteBoundary: rectPoly(12, 18), siteRect: R(0, 0, 12, 18), buildingRects: [HOUSE],
  access: 'south', count: 2, floorLevel: 0, layoutPref: 'perpendicular', buildableRect: BUILDABLE, ...over,
});

describe('placeParkingSiteAware — offset loop bound', () => {
  it('12×18 envelope: a perpendicular band deeper than half the depth axis is attempted and places 2 stalls', () => {
    const p = placeParkingSiteAware(input());
    expect(p.fits).toBe(true);
    expect(p.layout).toBe('perpendicular');
    expect(p.stalls).toHaveLength(2);
    // real offsets were attempted (no silent empty scan)
    expect(p.attempts.some(a => a.includes('no band/layout/offset fit'))).toBe(false);
    for (const s of p.stalls) {
      expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual(PARKING_STALL_WIDTH - E);
      expect(Math.max(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual(PARKING_STALL_LENGTH - E);
    }
  });

  it('stalls stay inside the buildable envelope, never overlap each other, the building or the aisle', () => {
    const p = placeParkingSiteAware(input());
    const rs = p.stalls.map(s => s.rect);
    for (const r of rs) {
      expect(inside(r, BUILDABLE)).toBe(true);
      expect(overlap(r, HOUSE)).toBe(false);
      expect(overlap(r, p.aisle)).toBe(false);
    }
    expect(overlap(rs[0], rs[1])).toBe(false);
    expect(overlap(p.aisle, HOUSE)).toBe(false);
    // aisle reaches the street edge (south, y = 0)
    expect(Math.abs(p.aisle.y)).toBeLessThan(E);
  });

  it('the last valid offset (off === offEnd) is reachable', () => {
    // Buildable y 3.5–12 → dMax 12, offEnd = 12 − 8.5 = 3.5; a blocker kills every shallower aisle.
    const buildable = R(0, 3.5, 12, 8.5);
    const p = placeParkingSiteAware(input({ buildableRect: buildable, buildingRects: [R(0, 0, 5, 3.4)], count: 1 }));
    expect(p.fits).toBe(true);
    expect(p.aisle.y).toBeCloseTo(3.5, 6);
    expect(p.stalls).toHaveLength(1);
    expect(p.stalls[0].rect.y + p.stalls[0].rect.h).toBeCloseTo(12, 6);
    expect(inside(p.stalls[0].rect, buildable)).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(placeParkingSiteAware(input()))).toBe(JSON.stringify(placeParkingSiteAware(input())));
  });

  it('an impossible request still fails honestly with no partial row', () => {
    const p = placeParkingSiteAware(input({ count: 4 }));
    expect(p.fits).toBe(false);
    expect(p.stalls).toHaveLength(0);
    expect(p.stallRects).toHaveLength(0);
  });

  it('parallel preference on the same envelope is unaffected (shallow band)', () => {
    const p = placeParkingSiteAware(input({ layoutPref: 'parallel', count: 1 }));
    expect(p.fits).toBe(true);
    expect(p.layout).toBe('parallel');
    for (const s of p.stalls) expect(inside(s.rect, BUILDABLE)).toBe(true);
  });
});
