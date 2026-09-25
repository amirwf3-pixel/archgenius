/**
 * Phase 5.5D — opt-in `diningEntryColumn` (rectangular placer, 5.4A gallery branch).
 *
 * Where the 5.4A dining would exceed DINING_DAYLIGHT_MAX and the 5.5A façade row cannot
 * keep the kitchen contact, the gallery cells are stacked in a column against the
 * corridor, living sits at the street façade and dining behind it on the kitchen.
 * Every programme minimum and contact is checked; any failure falls back to the
 * unchanged 5.4A path. The generator adopts the variant only through the unchanged
 * 5.4A guard. OFF must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { diningEntryColumnLayout, DINING_DAYLIGHT_MAX, DINING_ENTRY_COLUMN_PLACED, type FacadeRowCell } from './placer.js';
import { generateLayouts } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';

const E = 1e-6;
const CONTACT = 0.94 - E; // shared-wall length used as "real contact" (FACADE_ROW_KITCHEN_CONTACT)
/** Gallery cells with generic programme minimums (entrance, foyer, guest WC). */
const CELLS: FacadeRowCell[] = [
  { minW: 1.2, minH: 1.4, minArea: 2.0, targetArea: 3.0 },
  { minW: 1.4, minH: 1.4, minArea: 3.0, targetArea: 4.0 },
  { minW: 1.1, minH: 1.4, minArea: 1.4, targetArea: 2.2 },
];
const PROG = { livMinW: 3.0, livMinH: 3.0, livMinArea: 12.0, livTargetArea: 22.0, dinMinW: 2.4, dinMinArea: 7.0, dinTargetArea: 12.0 };
type Args = Parameters<typeof diningEntryColumnLayout>[0];
/** Band-local frame: street y = 0, living side x = 0, corridor at x = W, kitchen behind (y = H). */
const args = (o: Partial<Args>): Args => {
  const W = o.W ?? 9.15, H = o.H ?? 9.1;
  return {
    W, H, L: 5.88, cells: CELLS, ...PROG, livingSideExterior: true,
    kitchen: { x: 0, y: H, w: W - 1.5, h: 3.0 },
    corridor: { x: W, y: 0, w: 1.2, h: H },
    ...o,
  };
};
const onGrid = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
const overlap = (p: Rect, q: Rect) =>
  Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1e-6 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1e-6;
/** Length of shared wall between two touching rects (0 when they don't touch). */
const contact = (p: Rect, q: Rect) => {
  const T = 0.005;
  const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  if (Math.abs(p.x + p.w - q.x) < T || Math.abs(q.x + q.w - p.x) < T) return Math.max(0, oy);
  if (Math.abs(p.y + p.h - q.y) < T || Math.abs(q.y + q.h - p.y) < T) return Math.max(0, ox);
  return 0;
};

function rects(a: Args, r: NonNullable<ReturnType<typeof diningEntryColumnLayout>>) {
  let y = 0;
  const cells = r.cellH.map(h => { const c = { x: r.mainW, y, w: r.galleryW, h }; y += h; return c; });
  return {
    cells,
    living: { x: 0, y: 0, w: r.mainW, h: r.livingH },
    dining: { x: 0, y: r.livingH, w: r.mainW, h: r.diningH },
  };
}

describe('Phase 5.5D — diningEntryColumnLayout (pure geometry)', () => {
  const cases: Array<Partial<Args>> = [
    {},                                  // representative rectE/b2 frame
    { W: 10.4, H: 9.8 },
    { W: 8.6, H: 12.5 },
    { W: 11.2, H: 13.6 },
  ];

  it('is deterministic', () => {
    for (const c of cases) expect(diningEntryColumnLayout(args(c))).toEqual(diningEntryColumnLayout(args(c)));
  });

  it('keeps living and dining ≤ 7 m, meets every minimum, keeps all three contacts, never overlaps, stays in the band', () => {
    let hits = 0;
    for (const c of cases) {
      const a = args(c);
      const r = diningEntryColumnLayout(a);
      if (!r) continue;
      hits++;
      const g = rects(a, r);
      for (const q of [g.living, g.dining]) {
        expect(Math.max(q.w, q.h)).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
      }
      expect(Math.min(g.living.w, g.living.h)).toBeGreaterThanOrEqual(Math.max(PROG.livMinW, PROG.livMinH) - E);
      expect(g.living.w * g.living.h).toBeGreaterThanOrEqual(PROG.livMinArea - E);
      expect(Math.min(g.dining.w, g.dining.h)).toBeGreaterThanOrEqual(PROG.dinMinW - E);
      expect(g.dining.w * g.dining.h).toBeGreaterThanOrEqual(PROG.dinMinArea - E);
      g.cells.forEach((q, i) => {
        expect(q.h).toBeGreaterThanOrEqual(CELLS[i].minH - E);
        expect(q.w).toBeGreaterThanOrEqual(CELLS[i].minW - E);
        expect(q.w * q.h).toBeGreaterThanOrEqual(CELLS[i].minArea - E);
        expect(contact(q, a.corridor!)).toBeGreaterThanOrEqual(CONTACT);        // gallery ↔ corridor
      });
      expect(contact(g.dining, a.kitchen!)).toBeGreaterThanOrEqual(CONTACT);     // dining ↔ kitchen
      expect(contact(g.living, g.dining)).toBeGreaterThanOrEqual(CONTACT);       // living ↔ dining
      expect(g.living.y).toBe(0);                                                 // living on the street
      expect(g.cells[0].y).toBe(0);                                               // entrance on the street
      expect(g.living.x).toBe(0);                                                 // living-side exterior edge
      const all = [...g.cells, g.living, g.dining];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
      for (const q of all) {
        expect(q.x).toBeGreaterThanOrEqual(-E); expect(q.y).toBeGreaterThanOrEqual(-E);
        expect(q.x + q.w).toBeLessThanOrEqual(a.W + E); expect(q.y + q.h).toBeLessThanOrEqual(a.H + E);
      }
      expect(r.livingH + r.diningH).toBeCloseTo(a.H, 6);
      expect(r.galleryW + r.mainW).toBeCloseTo(a.W, 6);
      for (const v of [r.galleryW, r.mainW, r.livingH, r.diningH, ...r.cellH]) expect(onGrid(v)).toBe(true);
    }
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it('matches the representative rectE/b2 frame', () => {
    const r = diningEntryColumnLayout(args({}))!;
    expect(r).not.toBeNull();
    expect(r.galleryW).toBeCloseTo(2.15, 6);
    expect(r.mainW).toBeCloseTo(7.0, 6);
  });

  it('returns null unless the living-side edge is exterior', () => {
    expect(diningEntryColumnLayout(args({ livingSideExterior: false }))).toBeNull();
  });

  it('returns null when the 5.4A dining would already be ≤ 7 m on both axes', () => {
    expect(diningEntryColumnLayout(args({ W: 9.0, H: 6.8, L: 5.0 }))).toBeNull();
  });

  it('returns null for insufficient width, excessive depth and invalid geometry', () => {
    expect(diningEntryColumnLayout(args({ W: 4.0, H: 9.1, L: 1.0 }))).toBeNull();        // main column < programme width
    expect(diningEntryColumnLayout(args({ H: 14.5 }))).toBeNull();                        // no ≤ 7 m living/dining split
    expect(diningEntryColumnLayout(args({ W: 0 }))).toBeNull();
    expect(diningEntryColumnLayout(args({ H: -1 }))).toBeNull();
    expect(diningEntryColumnLayout(args({ L: 9.5 }))).toBeNull();                         // L ≥ W
    expect(diningEntryColumnLayout(args({ cells: [] }))).toBeNull();
    expect(diningEntryColumnLayout(args({ H: 3.5, L: 1.0, W: 12 }))).toBeNull();          // cells don't fit the depth
  });

  it('returns null without a kitchen behind the dining or a corridor along the gallery', () => {
    expect(diningEntryColumnLayout(args({ kitchen: null }))).toBeNull();
    expect(diningEntryColumnLayout(args({ kitchen: { x: 0, y: 3.0, w: 2.0, h: 2.0 } }))).toBeNull();     // not behind
    expect(diningEntryColumnLayout(args({ kitchen: { x: 7.2, y: 9.1, w: 2.0, h: 3.0 } }))).toBeNull();   // behind the gallery only
    expect(diningEntryColumnLayout(args({ corridor: null }))).toBeNull();
    expect(diningEntryColumnLayout(args({ corridor: { x: 5.0, y: 0, w: 1.2, h: 9.1 } }))).toBeNull();    // not at x = W
    expect(diningEntryColumnLayout(args({ corridor: { x: 9.15, y: 6.0, w: 1.2, h: 3.1 } }))).toBeNull(); // misses the entrance cell
  });
});

/** Benchmark rectE/b2 seed 42 — the representative MBH4-DYL-001 case. */
const REP = {
  site: { shape: 'rectangle', width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2, setbackEast: 2, setbackWest: 2 },
  building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
  seed: 42, deterministic: true, jurisdiction: 'IR',
} as const;
const R0 = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const INPUTS = [
  REP,
  { site: R0, building: REP.building, seed: 42, deterministic: true, jurisdiction: 'IR' },
  { site: { ...R0, width: 14, length: 22 }, building: { ...REP.building, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 }, seed: 7, deterministic: true, jurisdiction: 'IR' },
];
const ALL11: Record<string, boolean> = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true,
};
const STRAT = ['daylight-orientation'] as never;
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as never;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const run = (inp: unknown, opts?: Record<string, boolean>, s = STRATS): LayoutCandidate[] =>
  opts ? generateLayouts(clone(inp) as never, s, opts) : generateLayouts(clone(inp) as never, s);
const geom = (c: LayoutCandidate) => JSON.stringify({ f: c.floors, x: c.explanations, v: c.valid, n: c.findings.map(f => `${f.severity}:${f.code}`) });
const byType = (c: LayoutCandidate, t: string) => c.floors[0].spaces.filter(s => s.type === t);

describe('Phase 5.5D — generator integration', () => {
  it('OFF (omitted / false) is identical to baseline, with and without the other options', () => {
    for (const inp of INPUTS) {
      expect(run(inp, { diningEntryColumn: false }).map(geom)).toEqual(run(inp).map(geom));
      expect(run(inp, { ...ALL11, diningEntryColumn: false }).map(geom)).toEqual(run(inp, ALL11).map(geom));
    }
  });

  it('is inert without galleryDaylightAware', () => {
    for (const inp of INPUTS) expect(run(inp, { diningEntryColumn: true }).map(geom)).toEqual(run(inp).map(geom));
  });

  it('representative rectE/b2/seed42/daylight-orientation: clears MBH4-DYL-001 through the 5.4A guard', () => {
    const [off] = run(REP, ALL11, STRAT);
    const [on] = run(REP, { ...ALL11, diningEntryColumn: true }, STRAT);
    const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');
    expect(hard(off).map(f => f.code)).toContain('MBH4-DYL-001');
    expect(hard(on)).toEqual([]);
    expect(on.valid).toBe(true);
    // per-code: no HARD or circulation / access / daylight finding of any severity added
    const WATCH = /^CIRC|ACCESS|DAYLIGHT|DYL|INACCESSIBLE/;
    const counts = (c: LayoutCandidate) => {
      const m = new Map<string, number>();
      for (const f of c.findings) if (f.severity === 'hard' || WATCH.test(f.code)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
      return m;
    };
    const co = counts(off);
    for (const [k, n] of counts(on)) expect(n).toBeLessThanOrEqual(co.get(k) ?? 0);
    const soft = (c: LayoutCandidate) => c.findings.filter(f => f.code === 'ROOM_DAYLIGHT_QUALITY').length;
    expect(soft(on)).toBeLessThanOrEqual(soft(off));
    expect(on.explanations.some(e => e.startsWith(DINING_ENTRY_COLUMN_PLACED))).toBe(true);
    // With ALL11 a later guarded repair (5.4D) is rebuilt on top of the 5.5D variant; the
    // adoption lines themselves are asserted in the minimal 5.4A + 5.5D configuration.
    const [minOff] = run(REP, { galleryDaylightAware: true }, STRAT);
    const [minOn] = run(REP, { galleryDaylightAware: true, diningEntryColumn: true }, STRAT);
    expect(minOn.explanations.some(e => e.startsWith('Phase 5.5D: dining entry-column variant adopted'))).toBe(true);
    expect(minOn.explanations.some(e => e.startsWith('Phase 5.4A: daylight-aware entry-gallery variant adopted'))).toBe(true);
    const dyl = (c: LayoutCandidate) => c.findings.filter(f => f.code === 'MBH4-DYL-001').length;
    expect(dyl(minOn)).toBeLessThan(dyl(minOff));

    const g = on.floors[0].spaces;
    const din = byType(on, 'dining')[0], liv = byType(on, 'living')[0], kit = byType(on, 'kitchen')[0];
    for (const q of [din, liv]) expect(Math.max(q.rect.w, q.rect.h)).toBeLessThanOrEqual(DINING_DAYLIGHT_MAX + E);
    expect(din.hasExteriorWall).toBe(true);
    expect(liv.hasExteriorWall).toBe(true);
    expect(contact(din.rect, kit.rect)).toBeGreaterThanOrEqual(CONTACT);
    expect(contact(din.rect, liv.rect)).toBeGreaterThanOrEqual(CONTACT);
    const corr = byType(on, 'corridor');
    expect(corr.length).toBeGreaterThan(0);
    for (const t of ['entrance', 'foyer', 'guest-wc']) {
      const cell = byType(on, t)[0];
      expect(cell).toBeDefined();
      expect(corr.some(c => contact(cell.rect, c.rect) >= CONTACT)).toBe(true);   // gallery ↔ corridor
    }
    // stair, stair hall and corridor unmoved (every floor)
    const pick = (c: LayoutCandidate) => JSON.stringify(c.floors.map(f => ({
      st: f.stairs, s: f.spaces.filter(s => s.type === 'corridor' || s.type === 'stair-hall').map(s => s.rect),
    })));
    expect(pick(on)).toEqual(pick(off));
    // no overlaps; inside the buildable boundary
    for (let p = 0; p < g.length; p++) for (let q = p + 1; q < g.length; q++) expect(overlap(g[p].rect, g[q].rect)).toBe(false);
    const br = (on.floors[0].buildableRects ?? [on.floors[0].footprint]) as Rect[];
    const inside = (r: Rect) => br.some(b => r.x >= b.x - E && r.y >= b.y - E && r.x + r.w <= b.x + b.w + E && r.y + r.h <= b.y + b.h + E);
    for (const s of g) expect(inside(s.rect)).toBe(true);
  });

  it('adoption never regresses validity or HARD counts and is deterministic across strategies', () => {
    for (const inp of INPUTS) {
      const off = run(inp, ALL11), on = run(inp, { ...ALL11, diningEntryColumn: true });
      for (const c of on) {
        const b = off.find(x => x.metadata.strategy === c.metadata.strategy)!;
        if (b.valid) expect(c.valid).toBe(true);
        const hc = (x: LayoutCandidate) => x.findings.filter(f => f.severity === 'hard').length;
        expect(hc(c)).toBeLessThanOrEqual(hc(b));
      }
      expect(run(inp, { ...ALL11, diningEntryColumn: true }).map(geom)).toEqual(on.map(geom));
    }
  });

  it('pipeline: DXF output with the option omitted / false is byte-identical', () => {
    const mk = () => createProject(clone(REP) as never);
    const dxf = (o?: Record<string, boolean>) => writeDXF(generate(mk(), o as never).candidates[0]);
    expect(dxf({ diningEntryColumn: false })).toBe(dxf());
    expect(dxf({ ...ALL11, diningEntryColumn: false })).toBe(dxf(ALL11));
  });
});
