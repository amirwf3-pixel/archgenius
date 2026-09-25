/**
 * Phase 5.5A — opt-in `diningFacadeRow` (rectangular placer, 5.4A gallery branch).
 *
 * Gallery cells and dining share the street-façade row (depth ≤ DINING_DAYLIGHT_MAX),
 * living spans the full band behind it. Every programme minimum is checked; any
 * failure falls back to the unchanged 5.4A arrangement. The generator adopts the
 * variant only through the unchanged 5.4A guard. OFF must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { diningFacadeRowLayout, DINING_DAYLIGHT_MAX, type FacadeRowCell } from './placer.js';
import { generateLayouts } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';

const E = 1e-6;
/** Gallery cells with generic programme minimums (entrance, foyer, guest WC). */
const CELLS: FacadeRowCell[] = [
  { minW: 1.2, minH: 1.4, minArea: 2.0, targetArea: 3.0 },
  { minW: 1.4, minH: 1.4, minArea: 3.0, targetArea: 4.0 },
  { minW: 1.1, minH: 1.4, minArea: 1.4, targetArea: 2.2 },
];
const PROG = { livMinW: 3.0, livMinH: 3.0, livMinArea: 12.0, dinMinW: 2.4, dinMinArea: 7.0 };
type Args = Parameters<typeof diningFacadeRowLayout>[0];
const args = (o: Partial<Args>): Args => ({ W: 11.6, H: 8.48, L: 7.46, galleryH: 1.86, cells: CELLS, ...PROG, ...o });
const onGrid = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/** Rebuild the band-local rects the placer emits from a layout result. */
function rects(a: Args, r: NonNullable<ReturnType<typeof diningFacadeRowLayout>>): { cells: Rect[]; dining: Rect; living: Rect } {
  let x = 0;
  const cells = r.cellW.map(w => { const c = { x, y: 0, w, h: r.rowD }; x += w; return c; });
  return {
    cells,
    dining: { x: r.galleryW, y: 0, w: r.diningW, h: r.rowD },
    living: { x: 0, y: r.rowD, w: a.W, h: r.livingH },
  };
}
const overlap = (p: Rect, q: Rect) =>
  Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1e-6 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1e-6;

describe('Phase 5.5A — diningFacadeRowLayout (pure geometry)', () => {
  const cases: Array<Partial<Args>> = [
    {},
    { W: 9.15, H: 9.1, L: 5.88, galleryH: 2.0 },
    { W: 14.0, H: 6.2, L: 6.0, galleryH: 1.9 },    // wide frontage, shallow band
    { W: 12.3, H: 10.4, L: 8.1, galleryH: 2.2 },
    { W: 16.5, H: 8.0, L: 7.0, galleryH: 1.5 },    // W − L > 7 → gallery widened
  ];

  it('is deterministic', () => {
    for (const c of cases) expect(diningFacadeRowLayout(args(c))).toEqual(diningFacadeRowLayout(args(c)));
  });

  it('keeps dining ≤ 7 m on both axes, meets every minimum, snaps to 1 cm and tiles the band without overlap', () => {
    let hits = 0;
    for (const c of cases) {
      const a = args(c);
      const r = diningFacadeRowLayout(a);
      if (!r) continue;
      hits++;
      expect(r.diningW).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
      expect(r.rowD).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
      expect(Math.min(r.diningW, r.rowD)).toBeGreaterThanOrEqual(PROG.dinMinW - E);
      expect(r.diningW * r.rowD).toBeGreaterThanOrEqual(PROG.dinMinArea - E);
      expect(r.livingH).toBeGreaterThanOrEqual(PROG.livMinH - E);
      expect(a.W * r.livingH).toBeGreaterThanOrEqual(PROG.livMinArea - E);
      r.cellW.forEach((w, i) => {
        expect(w).toBeGreaterThanOrEqual(CELLS[i].minW - E);
        expect(w * r.rowD).toBeGreaterThanOrEqual(CELLS[i].minArea - E);
      });
      expect(r.rowD).toBeGreaterThanOrEqual(a.galleryH - E);
      for (const v of [r.galleryW, r.rowD, r.livingH, ...r.cellW]) expect(onGrid(v)).toBe(true);
      const g = rects(a, r);
      const all = [...g.cells, g.dining, g.living];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
      const area = all.reduce((t, q) => t + q.w * q.h, 0);
      expect(Math.abs(area - a.W * (r.rowD + r.livingH))).toBeLessThan(1e-6);
      expect(r.cellW.reduce((t, w) => t + w, 0)).toBeCloseTo(r.galleryW, 6);
      expect(r.galleryW + r.diningW).toBeCloseTo(a.W, 6);
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  it('returns null (5.4A fallback) when 5.4A dining would already be ≤ 7 m on both axes', () => {
    expect(diningFacadeRowLayout(args({ W: 10.0, H: 6.8, L: 5.0 }))).toBeNull();
  });

  it('returns null when a programme minimum cannot be met', () => {
    expect(diningFacadeRowLayout(args({ W: 9.0, H: 9.0, L: 7.0 }))).toBeNull();          // dining frontage 2.0 < 2.4
    expect(diningFacadeRowLayout(args({ W: 9.0, H: 9.0, L: 3.0 }))).toBeNull();          // cells don't fit 3.0 m
    expect(diningFacadeRowLayout(args({ H: 8.0, galleryH: 5.5 }))).toBeNull();           // living depth 2.5 < 3.0
    expect(diningFacadeRowLayout(args({ cells: [] }))).toBeNull();
  });

  it('keeps kitchen contact: a dining-end kitchen deepens the row; an unreachable kitchen falls back', () => {
    const a = args({});
    const free = diningFacadeRowLayout(a)!;
    const endK: Rect = { x: a.W, y: 2.64, w: 2.4, h: 5.84 };
    const r = diningFacadeRowLayout({ ...a, kitchen: endK })!;
    expect(r).not.toBeNull();
    expect(r.rowD).toBeGreaterThan(free.rowD);
    const contact = Math.min(r.rowD, endK.y + endK.h) - Math.max(0, endK.y);
    expect(contact).toBeGreaterThanOrEqual(0.94 - E);
    expect(r.rowD).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
    // kitchen behind the band touching the 5.4A dining → the row cannot reach it.
    expect(diningFacadeRowLayout({ ...a, kitchen: { x: 0, y: a.H, w: a.W, h: 2 } })).toBeNull();
    // kitchen at the dining end but too deep to reach within 7 m → fallback.
    expect(diningFacadeRowLayout({ ...a, kitchen: { x: a.W, y: 6.8, w: 2.4, h: 1.68 } })).toBeNull();
    // kitchen not touching the 5.4A dining → no constraint.
    expect(diningFacadeRowLayout({ ...a, kitchen: { x: -3, y: 0, w: 3, h: 4 } })).toEqual(free);
  });
});

/** A generic sweep site (random generator output) where the façade row is adopted. */
const ADOPT_INPUT = {
  site: { shape: 'rectangle', width: 16.19, length: 30.33, streetWidth: 8.31, accessSide: 'west', setbackNorth: 1.93, setbackSouth: 2.83, setbackEast: 0.59, setbackWest: 0.92 },
  building: { type: 'villa', bedrooms: 1, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1, hasElevator: false, hasStorage: true },
  seed: 80, deterministic: true, jurisdiction: 'IR',
} as const;
const R0 = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const INPUTS = [
  ADOPT_INPUT,
  { site: R0, building: B2, seed: 42, deterministic: true, jurisdiction: 'IR' },
  { site: { ...R0, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 }, building: B2, seed: 7, deterministic: true, jurisdiction: 'IR' },
  { site: { ...R0, width: 14, length: 22 }, building: { ...B2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 }, seed: 42, deterministic: true, jurisdiction: 'IR' },
];
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as never;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const run = (inp: unknown, opts?: Record<string, boolean>): LayoutCandidate[] =>
  opts ? generateLayouts(clone(inp) as never, STRATS, opts) : generateLayouts(clone(inp) as never, STRATS);
const ADOPTED = 'Phase 5.5A: dining façade-row variant adopted';
const geom = (c: LayoutCandidate) => JSON.stringify({ f: c.floors, x: c.explanations, v: c.valid, n: c.findings.map(f => f.code) });

describe('Phase 5.5A — generator integration', () => {
  it('OFF (omitted / false) is identical to baseline, with and without 5.4A', () => {
    for (const inp of INPUTS) {
      const base = run(inp).map(geom);
      expect(run(inp, { diningFacadeRow: false }).map(geom)).toEqual(base);
      const g = run(inp, { galleryDaylightAware: true }).map(geom);
      expect(run(inp, { galleryDaylightAware: true, diningFacadeRow: false }).map(geom)).toEqual(g);
    }
  });

  it('is inert without galleryDaylightAware', () => {
    for (const inp of INPUTS) expect(run(inp, { diningFacadeRow: true }).map(geom)).toEqual(run(inp).map(geom));
  });

  it('adopts the façade row through the 5.4A guard: DYL-001 falls, validity and HARD never regress, dining ≤ 7 m', () => {
    const off = run(ADOPT_INPUT, { galleryDaylightAware: true });
    const on = run(ADOPT_INPUT, { galleryDaylightAware: true, diningFacadeRow: true });
    let adopted = 0;
    on.forEach((c, i) => {
      const b = off[i];
      expect(c.metadata.strategy).toBe(b.metadata.strategy);
      const hard = (x: LayoutCandidate) => x.findings.filter(f => f.severity === 'hard').length;
      const dyl = (x: LayoutCandidate) => x.findings.filter(f => f.code === 'MBH4-DYL-001').length;
      if (!c.explanations.some(e => e.startsWith(ADOPTED))) { expect(geom(c)).toEqual(geom(b)); return; }
      adopted++;
      expect(dyl(c)).toBeLessThan(dyl(b));
      expect(hard(c)).toBeLessThanOrEqual(hard(b));
      if (b.valid) expect(c.valid).toBe(true);
      const g = c.floors[0].spaces;
      const din = g.find(s => s.type === 'dining')!;
      expect(Math.max(din.rect.w, din.rect.h)).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
      expect(din.hasExteriorWall).toBe(true);
      for (let p = 0; p < g.length; p++) for (let q = p + 1; q < g.length; q++) expect(overlap(g[p].rect, g[q].rect)).toBe(false);
    });
    expect(adopted).toBeGreaterThanOrEqual(1);
    expect(run(ADOPT_INPUT, { galleryDaylightAware: true, diningFacadeRow: true }).map(geom)).toEqual(on.map(geom));
  });

  it('pipeline: DXF output with the option omitted / false is byte-identical', () => {
    const mk = () => createProject(clone(INPUTS[1]) as never);
    const dxf = (o?: Record<string, boolean>) => writeDXF(generate(mk(), o as never).candidates[0]);
    const base = dxf();
    expect(dxf({ diningFacadeRow: false })).toBe(base);
    expect(dxf({ galleryDaylightAware: true, diningFacadeRow: false })).toBe(dxf({ galleryDaylightAware: true }));
  });
});
