/**
 * Per-room dimension callouts — ROADMAP Phase 5 plan inspection
 * ("per-room dimension callouts").
 *
 * The geometry and screen layout are pure (room-dimensions.ts), so they are
 * tested without a DOM, like canvas-view.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { generateLayouts } from '@archgenius/core';
import {
  roomEdgeDimensions, layoutDimensionCallouts, selectedRoomCallouts, dimensionCaption,
  formatDimension, DEFAULT_DIM_LAYOUT, type Pt, type DimensionCallout,
} from './room-dimensions';
import { PlanCanvas, computeBounds, makeTransform } from './PlanCanvas';
import { t, isPersianText } from './i18n';

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
/** 6-vertex L-shape: 6×5 box with a 2×2 notch at the top-right corner. */
const L: Pt[] = [
  { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 5 }, { x: 0, y: 5 },
];

const pointInPoly = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** Screen mapping that mimics the canvas: y-down, scale s. */
const screen = (s: number) => ({ tx: (x: number) => 50 + x * s, ty: (y: number) => 500 - y * s });

const boxesOverlap = (p: DimensionCallout, q: DimensionCallout) => {
  const bb = (c: DimensionCallout) => {
    const cos = Math.abs(Math.cos(c.angle)), sin = Math.abs(Math.sin(c.angle));
    const hw = (c.textW * cos + c.textH * sin) / 2, hh = (c.textW * sin + c.textH * cos) / 2;
    return [c.textX - hw, c.textY - hh, c.textX + hw, c.textY + hh];
  };
  const [a0, a1, a2, a3] = bb(p), [b0, b1, b2, b3] = bb(q);
  return a0 < b2 && a2 > b0 && a1 < b3 && a3 > b1;
};

describe('roomEdgeDimensions — rectangular room', () => {
  const edges = roomEdgeDimensions(rect(2, 1, 3.45, 4.2));

  it('returns one edge per side with exact polygon lengths', () => {
    expect(edges.map(e => e.index)).toEqual([0, 1, 2, 3]);
    expect(edges.map(e => e.length)).toEqual([3.45, 4.2, 3.45, 4.2].map(v => expect.closeTo(v, 9)));
    expect(edges.map(e => e.label)).toEqual(['3.45 m', '4.20 m', '3.45 m', '4.20 m']);
  });

  it('outward normals point out of the room', () => {
    const poly = rect(2, 1, 3.45, 4.2);
    for (const e of edges) {
      expect(Math.hypot(e.normal.x, e.normal.y)).toBeCloseTo(1, 12);
      expect(pointInPoly({ x: e.mid.x + e.normal.x * 0.1, y: e.mid.y + e.normal.y * 0.1 }, poly)).toBe(false);
      expect(pointInPoly({ x: e.mid.x - e.normal.x * 0.1, y: e.mid.y - e.normal.y * 0.1 }, poly)).toBe(true);
    }
  });

  it('uses the canvas / spaces-panel number convention (2 decimals, metres)', () => {
    expect(formatDimension(9.859999999999985)).toBe('9.86 m');
    expect(formatDimension(3)).toBe('3.00 m');
  });
});

describe('roomEdgeDimensions — non-rectangular polygon', () => {
  it('measures all six edges of an L-shaped room', () => {
    const edges = roomEdgeDimensions(L);
    expect(edges.map(e => e.label)).toEqual(['6.00 m', '3.00 m', '2.00 m', '2.00 m', '4.00 m', '5.00 m']);
    const perimeter = edges.reduce((s, e) => s + e.length, 0);
    expect(perimeter).toBeCloseTo(22, 12);
    for (const e of edges) {
      expect(pointInPoly({ x: e.mid.x + e.normal.x * 0.05, y: e.mid.y + e.normal.y * 0.05 }, L)).toBe(false);
    }
  });

  it('is orientation-independent (clockwise ring gives the same lengths, still outward normals)', () => {
    const cw = [...L].reverse();
    const edges = roomEdgeDimensions(cw);
    expect(edges.map(e => e.length).sort()).toEqual(roomEdgeDimensions(L).map(e => e.length).sort());
    for (const e of edges) {
      expect(pointInPoly({ x: e.mid.x + e.normal.x * 0.05, y: e.mid.y + e.normal.y * 0.05 }, cw)).toBe(false);
    }
  });

  it('merges collinear vertices and drops duplicate / closing points', () => {
    const noisy: Pt[] = [
      { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 3 }, { x: 4, y: 3 },
      { x: 4, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 2 }, { x: 0, y: 0 },
    ];
    expect(roomEdgeDimensions(noisy).map(e => e.label)).toEqual(roomEdgeDimensions(L).map(e => e.label));
  });

  it('returns nothing for degenerate input', () => {
    expect(roomEdgeDimensions(undefined)).toEqual([]);
    expect(roomEdgeDimensions([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([]);
    expect(roomEdgeDimensions([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual([]);
  });

  it('never mutates the input polygon', () => {
    const poly = L.map(p => ({ ...p }));
    const before = JSON.stringify(poly);
    roomEdgeDimensions(poly);
    layoutDimensionCallouts(roomEdgeDimensions(poly), screen(40).tx, screen(40).ty);
    expect(JSON.stringify(poly)).toBe(before);
  });
});

describe('layoutDimensionCallouts — screen layout', () => {
  it('keeps a constant pixel offset and font size at every zoom (readable when zooming)', () => {
    for (const s of [40, 80, 160]) {
      const { tx, ty } = screen(s);
      const cs = layoutDimensionCallouts(roomEdgeDimensions(rect(0, 0, 4, 3)), tx, ty);
      expect(cs).toHaveLength(4);
      for (const c of cs) {
        const [ax, ay, lx, ly] = c.ext[0];
        expect(Math.hypot(lx - ax, ly - ay)).toBeCloseTo(DEFAULT_DIM_LAYOUT.offsetPx, 9);
        expect(c.textH).toBeCloseTo(DEFAULT_DIM_LAYOUT.fontPx * 1.2, 9);
        expect(c.angle).toBeGreaterThan(-Math.PI / 2);
        expect(c.angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      }
    }
  });

  it('places the dimension line outside the room', () => {
    const { tx, ty } = screen(40);
    const poly = rect(0, 0, 4, 3);
    const screenPoly = poly.map(p => ({ x: tx(p.x), y: ty(p.y) }));
    for (const c of layoutDimensionCallouts(roomEdgeDimensions(poly), tx, ty)) {
      expect(pointInPoly({ x: c.textX, y: c.textY }, screenPoly)).toBe(false);
    }
  });

  it('skips edges too short on screen and never returns overlapping labels', () => {
    const edges = roomEdgeDimensions(L);
    const far = layoutDimensionCallouts(edges, screen(8).tx, screen(8).ty);
    const near = layoutDimensionCallouts(edges, screen(80).tx, screen(80).ty);
    expect(far.length).toBeLessThan(edges.length);
    expect(near).toHaveLength(edges.length);
    for (const set of [far, near]) {
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
        expect(boxesOverlap(set[i], set[j])).toBe(false);
      }
    }
  });
});

describe('determinism', () => {
  it('identical input gives byte-identical callouts', () => {
    const run = () => JSON.stringify(layoutDimensionCallouts(roomEdgeDimensions(L), screen(37).tx, screen(37).ty));
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toBe(first);
  });

  it('matches a generated candidate: lengths are the canonical Space.polygon edges', () => {
    const input = {
      site: { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 },
      building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
      seed: 42, deterministic: true, jurisdiction: 'IR',
    } as any;
    const [cand] = generateLayouts(JSON.parse(JSON.stringify(input)), ['area-efficiency']);
    const floor = cand.floors[0];
    const snapshot = JSON.stringify(floor.spaces);
    for (const sp of floor.spaces) {
      const edges = roomEdgeDimensions(sp.polygon);
      expect(edges.length).toBeGreaterThanOrEqual(3);
      for (const e of edges) expect(e.label).toBe(formatDimension(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)));
      if (sp.polygon.length === 4) {
        const ls = edges.map(e => e.length).sort((a, b) => a - b);
        const [w, h] = [sp.rect.w, sp.rect.h].sort((a, b) => a - b);
        expect(ls[0]).toBeCloseTo(w, 6);
        expect(ls[3]).toBeCloseTo(h, 6);
      }
    }
    expect(JSON.stringify(floor.spaces)).toBe(snapshot); // geometry untouched
    const b = computeBounds(cand, floor);
    const { tx, ty } = makeTransform(b, 800, 560, { z: 1, px: 0, py: 0 });
    const id = floor.spaces[0].id;
    expect(JSON.stringify(selectedRoomCallouts(floor, id, tx, ty))).toBe(JSON.stringify(selectedRoomCallouts(floor, id, tx, ty)));
  });
});

describe('selected / unselected behaviour', () => {
  const floor = {
    spaces: [
      { id: 's-rect', label: 'Kitchen', polygon: rect(0, 0, 4, 3) },
      { id: 's-l', label: 'Living', polygon: L },
    ],
  };
  const { tx, ty } = screen(60);

  it('no selection → no callouts', () => {
    expect(selectedRoomCallouts(floor, null, tx, ty)).toEqual([]);
    expect(selectedRoomCallouts(floor, undefined, tx, ty)).toEqual([]);
  });

  it('selection not on this floor → no callouts', () => {
    expect(selectedRoomCallouts(floor, 'other-floor-space', tx, ty)).toEqual([]);
  });

  it('callouts follow the selection deterministically', () => {
    const a = selectedRoomCallouts(floor, 's-rect', tx, ty);
    const b = selectedRoomCallouts(floor, 's-l', tx, ty);
    expect(a.map(c => c.label)).toEqual(['4.00 m', '3.00 m', '4.00 m', '3.00 m']);
    expect(b.map(c => c.label)).toEqual(['6.00 m', '3.00 m', '2.00 m', '2.00 m', '4.00 m', '5.00 m']);
    expect(selectedRoomCallouts(floor, 's-rect', tx, ty)).toEqual(a);
  });

  it('PlanCanvas renders with and without a selected space', () => {
    const cand = { id: 'c', floors: [{ level: 0, footprint: { x: 0, y: 0, w: 6, h: 5 }, spaces: [], walls: [], openings: [], stairs: [], elevators: [], furniture: [], parkingStalls: [] }] } as any;
    expect(renderToString(<PlanCanvas candidate={cand} selectedSpaceId={null} />)).toContain('<canvas');
    expect(renderToString(<PlanCanvas candidate={cand} selectedSpaceId="s-rect" />)).toContain('<canvas');
  });
});

describe('Persian / i18n', () => {
  it('caption uses the i18n dictionary, Persian room label and Persian count digits', () => {
    expect(isPersianText(t('canvasDimCaption'))).toBe(true);
    const cap = dimensionCaption('Kitchen', 6);
    expect(isPersianText(cap)).toBe(true);
    expect(cap).toContain('۶');
    expect(cap).not.toContain('Kitchen');
    expect(cap).not.toContain('{');
  });

  it('dimension values stay technical (Western digits, LTR) like the rest of the canvas', () => {
    for (const e of roomEdgeDimensions(L)) expect(e.label).toMatch(/^\d+\.\d{2} m$/);
  });
});
