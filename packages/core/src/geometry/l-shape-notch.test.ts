/**
 * createLShapePolygon: every notch corner removes exactly its own nW × nL corner of the
 * W × L bounding box (south = y 0, west = x 0), for both the short and long corner names.
 */
import { describe, it, expect } from 'vitest';
import { createLShapePolygon, rectInsidePolygon } from './polygon-ops.js';
import { computeBuildableGeometry } from '../site/buildable.js';

type Pt = { x: number; y: number };
const area = (p: Pt[]) => Math.abs(p.reduce((a, v, i) => { const q = p[(i + 1) % p.length]; return a + v.x * q.y - q.x * v.y; }, 0)) / 2;
const key = (p: Pt[]) => p.map(v => `${v.x},${v.y}`).sort();
const probeIn = (p: Pt[], x: number, y: number) => rectInsidePolygon({ x: x - 0.01, y: y - 0.01, w: 0.02, h: 0.02 }, p, 0);

const W = 14, L = 20, NW = 5, NL = 7;
/** Expected removed notch rect per corner. */
const NOTCH = {
  ne: { x0: W - NW, y0: L - NL, x1: W, y1: L },
  nw: { x0: 0, y0: L - NL, x1: NW, y1: L },
  se: { x0: W - NW, y0: 0, x1: W, y1: NL },
  sw: { x0: 0, y0: 0, x1: NW, y1: NL },
} as const;
const LONG = { ne: 'north-east', nw: 'north-west', se: 'south-east', sw: 'south-west' } as const;

describe('createLShapePolygon — notch corners', () => {
  for (const c of ['ne', 'nw', 'se', 'sw'] as const) {
    it(`${c}: removes exactly its own ${NW}×${NL} corner, area W·L − nW·nL`, () => {
      const p = createLShapePolygon(W, L, NW, NL, c);
      expect(p).toHaveLength(6);
      expect(area(p)).toBeCloseTo(W * L - NW * NL, 12);
      const n = NOTCH[c];
      // notch centre and its four inner corners' neighbourhoods are outside
      expect(probeIn(p, (n.x0 + n.x1) / 2, (n.y0 + n.y1) / 2)).toBe(false);
      // every other bounding-box corner stays inside
      for (const [x, y] of [[0.5, 0.5], [W - 0.5, 0.5], [0.5, L - 0.5], [W - 0.5, L - 0.5]]) {
        const inNotch = x > n.x0 && x < n.x1 && y > n.y0 && y < n.y1;
        expect(probeIn(p, x, y), `${c} probe ${x},${y}`).toBe(!inNotch);
      }
      // the vertex set is exactly the bounding box with the notch corner replaced
      const corner = { x: c.endsWith('e') ? W : 0, y: c.startsWith('n') ? L : 0 };
      const inner = { x: c.endsWith('e') ? W - NW : NW, y: c.startsWith('n') ? L - NL : NL };
      const box = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: L }, { x: 0, y: L }].filter(v => !(v.x === corner.x && v.y === corner.y));
      expect(key(p)).toEqual(key([...box, { x: inner.x, y: corner.y }, { x: inner.x, y: inner.y }, { x: corner.x, y: inner.y }]));
    });

    it(`${c}: long corner name '${LONG[c]}' gives the identical polygon; output deterministic`, () => {
      const a = createLShapePolygon(W, L, NW, NL, c);
      expect(createLShapePolygon(W, L, NW, NL, LONG[c])).toEqual(a);
      expect(createLShapePolygon(W, L, NW, NL, c)).toEqual(a);
    });
  }

  it('NE / NW / SW vertex sequences are unchanged (regression lock)', () => {
    expect(createLShapePolygon(W, L, NW, NL, 'ne')).toEqual([
      { x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 13 }, { x: 9, y: 13 }, { x: 9, y: 20 }, { x: 0, y: 20 }]);
    expect(createLShapePolygon(W, L, NW, NL, 'nw')).toEqual([
      { x: 0, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 20 }, { x: 5, y: 20 }, { x: 5, y: 13 }, { x: 0, y: 13 }]);
    expect(createLShapePolygon(W, L, NW, NL, 'sw')).toEqual([
      { x: 5, y: 0 }, { x: 14, y: 0 }, { x: 14, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 7 }, { x: 5, y: 7 }]);
  });

  it('origin offset translates the SE polygon', () => {
    const a = createLShapePolygon(W, L, NW, NL, 'se');
    const b = createLShapePolygon(W, L, NW, NL, 'se', 3, -2);
    expect(b).toEqual(a.map(v => ({ x: v.x + 3, y: v.y - 2 })));
  });

  it('SE 14×20 / 5×7, setbacks N1.5 S3 E1.5 W1.5: intended site and buildable L', () => {
    const g = computeBuildableGeometry({
      shape: 'l-shape', width: 14, length: 20, accessSide: 'south', streetWidth: 10,
      setbacks: { north: 1.5, south: 3, east: 1.5, west: 1.5 },
      lShape: { width: 14, length: 20, notchWidth: 5, notchLength: 7, notchCorner: 'se' },
    } as never);
    expect(g.siteArea).toBeCloseTo(245, 9);
    expect(key(g.siteBoundary)).toEqual(key([{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 7 }, { x: 14, y: 7 }, { x: 14, y: 20 }, { x: 0, y: 20 }]));
    expect(g.buildableArea).toBeCloseTo(135.5, 9);
    expect(key(g.buildableBoundary)).toEqual(key([{ x: 1.5, y: 3 }, { x: 7.5, y: 3 }, { x: 7.5, y: 10 }, { x: 12.5, y: 10 }, { x: 12.5, y: 18.5 }, { x: 1.5, y: 18.5 }]));
    const rects = [...g.buildableRects].sort((a, b) => a.y - b.y);
    expect(rects).toEqual([{ x: 1.5, y: 3, w: 6, h: 7 }, { x: 1.5, y: 10, w: 11, h: 8.5 }]);
  });
});
