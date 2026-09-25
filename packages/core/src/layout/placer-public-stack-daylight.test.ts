/**
 * Phase 5.4C — opt-in `stackPublicForDaylight` (rectangular placer public band).
 *
 * When the side-by-side living/dining row would leave dining with no exterior edge
 * while the band's living-side edge lies on the building exterior, the existing
 * front-to-back stack is reused: living at the front (foyer side), dining behind
 * (kitchen side), both touching the exterior side edge. Infeasible cases and OFF
 * must be identical; the generator adopts the variant only through the guard.
 */
import { describe, it, expect } from 'vitest';
import { placeSpaces, publicStackForDaylightApplies, type PlacedSpec } from './placer.js';
import { generateLayouts, adoptPublicStackDaylightVariant } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Space, SpaceType, Zone, AdjacencyRequirement } from '../model/space.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

type Out = { spaces: Space[]; corridors: Space[]; explanation: string[] };

const mkSpace = (type: SpaceType, r: Rect, label: string, id: string, zone: Zone): Space => ({
  id, type, label, zone, privacy: zone === 'circulation' ? 'service' : zone,
  polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  rect: { ...r }, area: r.w * r.h, targetArea: r.w * r.h, minArea: 0,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
}) as unknown as Space;

const DK: AdjacencyRequirement = { spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true };
function spec(type: SpaceType, minArea: number, targetArea: number, minWidth: number, privacy: 'public' | 'semi-private' | 'service' | 'private', adjacencies?: AdjacencyRequirement[]): PlacedSpec {
  return { type, minArea, targetArea, minWidth, privacy, priority: 5, adjacencies, placedId: `${type}-x`, placedLabel: type } as PlacedSpec;
}
/** Ground floor with programme minimums from TYPICAL_AREAS (generic, not benchmark data). */
function groundSpecs(): PlacedSpec[] {
  return [
    spec('entrance', 2.0, 3.0, 1.2, 'public'),
    spec('foyer', 3.0, 4.0, 1.4, 'public'),
    spec('guest-wc', 1.4, 2.2, 1.1, 'public'),
    spec('living', 12.0, 18.0, 3.0, 'public'),
    spec('dining', 7.0, 10.0, 2.4, 'semi-private', [DK]),
    spec('kitchen', 6.0, 10.0, 2.0, 'service', [{ ...DK, spaceType: 'dining' }]),
    spec('stair-hall', 4.5, 6.0, 1.2, 'service'),
    spec('bedroom', 9.0, 12.0, 2.5, 'private'),
    spec('bathroom', 2.4, 3.6, 1.3, 'private'),
  ];
}
function run(fp: Rect, strategy: string, opts?: { stackPublicForDaylight: boolean }): Out {
  return opts
    ? placeSpaces(fp, groundSpecs(), strategy as never, 'south', mkSpace, opts)
    : placeSpaces(fp, groundSpecs(), strategy as never, 'south', mkSpace);
}
const byType = (o: Out, t: string) => o.spaces.find(s => s.type === t)!;
const onFp = (r: Rect, fp: Rect) => {
  const e = 1e-6;
  return Math.abs(r.x - fp.x) < e || Math.abs(r.y - fp.y) < e || Math.abs(r.x + r.w - (fp.x + fp.w)) < e || Math.abs(r.y + r.h - (fp.y + fp.h)) < e;
};
function contact(a: Rect, b: Rect): number {
  const e = 1e-6;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((Math.abs(a.x + a.w - b.x) < e || Math.abs(b.x + b.w - a.x) < e) && oy > e) return oy;
  if ((Math.abs(a.y + a.h - b.y) < e || Math.abs(b.y + b.h - a.y) < e) && ox > e) return ox;
  return 0;
}
const overlapPairs = (sp: Space[]) => sp.flatMap((a, i) => sp.slice(i + 1).filter(b =>
  Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x) > 1e-6 &&
  Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y) > 1e-6).map(b => `${a.type}/${b.type}`)).sort();

// Generic footprints (arbitrary / decimal). Daylight-orientation: vertical spine, the
// public band's only exterior edge is its west side.
const FEASIBLE: Rect[] = [{ x: 0, y: 0, w: 14, h: 15 }, { x: 0, y: 0, w: 13.37, h: 17.21 }, { x: 0, y: 0, w: 15.3, h: 21.7 }];
// Area-efficiency full-width band behind the gallery: shorter than living+dining minimums.
const TOO_SHORT: Rect = { x: 0, y: 0, w: 14, h: 15 };
// Daylight-orientation where dining already reaches an exterior edge.
const ALREADY_EXTERIOR: Rect = { x: 0, y: 0, w: 12, h: 16 };

describe('Phase 5.4C stackPublicForDaylight — placer', () => {
  it('feasible: living front, dining behind, both on the exterior side edge; contacts kept', () => {
    for (const fp of FEASIBLE) {
      const off = run(fp, 'daylight-orientation');
      const on = run(fp, 'daylight-orientation', { stackPublicForDaylight: true });
      expect(onFp(byType(off, 'dining').rect, fp)).toBe(false);
      expect(on.explanation.some(e => e.startsWith('Phase 5.4C daylight-aware public stack'))).toBe(true);
      const L = byType(on, 'living').rect, D = byType(on, 'dining').rect, K = byType(on, 'kitchen').rect;
      // Stack geometry: same band x-extent, living in front of dining, both on the west façade.
      expect(L.x).toBeCloseTo(fp.x, 9);
      expect(D.x).toBeCloseTo(fp.x, 9);
      expect(L.w).toBeCloseTo(D.w, 9);
      expect(L.y + L.h).toBeCloseTo(D.y, 6);
      expect(L.y).toBeLessThan(D.y);
      expect(contact(byType(on, 'foyer').rect, L)).toBeGreaterThan(1.0);
      expect(contact(D, K)).toBeGreaterThan(1.0);
      expect(contact(L, D)).toBeGreaterThan(2.0);
      expect(on.spaces.map(s => s.type).sort()).toEqual(off.spaces.map(s => s.type).sort());
      // No overlap of the stacked rooms with any corridor or room (strict, after snapping).
      const stacked = on.spaces.filter(s => s.type === 'living' || s.type === 'dining');
      for (const r of stacked) {
        const others = [...on.spaces, ...on.corridors].filter(o => o !== r);
        expect(overlapPairs([r, ...others]).filter(p => p.startsWith(`${r.type}/`) || p.endsWith(`/${r.type}`)), `${fp.w}x${fp.h} ${r.type}`).toEqual([]);
        // Snapped 1 cm grid values.
        for (const v of [r.rect.x, r.rect.w]) expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
      }
      // Right edge sits on the grid at (or just inside) the corridor edge — never beyond it.
      const spine = on.corridors.find(c => c.rect.x >= L.x + L.w - 1e-9 && c.rect.x < L.x + L.w + 0.01 && c.rect.h > L.h)!;
      expect(spine).toBeDefined();
      expect(L.x + L.w).toBeLessThanOrEqual(spine.rect.x + 1e-9);
      expect(spine.rect.x - (L.x + L.w)).toBeLessThan(0.01);
    }
  });

  it('stacked rooms keep their programme minimums', () => {
    for (const fp of FEASIBLE) {
      const on = run(fp, 'daylight-orientation', { stackPublicForDaylight: true });
      const L = byType(on, 'living').rect, D = byType(on, 'dining').rect;
      expect(L.w * L.h).toBeGreaterThanOrEqual(12 - 1e-9);
      expect(Math.min(L.w, L.h)).toBeGreaterThanOrEqual(3.0 - 1e-9);
      expect(D.w * D.h).toBeGreaterThanOrEqual(7 - 1e-9);
      expect(Math.min(D.w, D.h)).toBeGreaterThanOrEqual(2.4 - 1e-9);
    }
  });

  it('too-short band: identical to legacy', () => {
    const off = run(TOO_SHORT, 'area-efficiency');
    expect(onFp(byType(off, 'dining').rect, TOO_SHORT)).toBe(false);
    expect(run(TOO_SHORT, 'area-efficiency', { stackPublicForDaylight: true })).toEqual(off);
  });

  it('dining already exterior: identical to legacy', () => {
    const off = run(ALREADY_EXTERIOR, 'daylight-orientation');
    expect(onFp(byType(off, 'dining').rect, ALREADY_EXTERIOR)).toBe(true);
    expect(run(ALREADY_EXTERIOR, 'daylight-orientation', { stackPublicForDaylight: true })).toEqual(off);
  });

  it('option false / omitted is the legacy call; deterministic', () => {
    const fp = FEASIBLE[0];
    expect(run(fp, 'daylight-orientation', { stackPublicForDaylight: false })).toEqual(run(fp, 'daylight-orientation'));
    expect(run(fp, 'daylight-orientation', { stackPublicForDaylight: true })).toEqual(run(fp, 'daylight-orientation', { stackPublicForDaylight: true }));
  });
});

describe('Phase 5.4C publicStackForDaylightApplies (pure predicate)', () => {
  const fp: Rect = { x: 0, y: 0, w: 14, h: 15 };
  const band: Rect = { x: 0, y: 2.3, w: 6.25, h: 8.8 };
  const kitchenBack: Rect = { x: 0, y: 11.1, w: 6.25, h: 2.8 };
  it('enclosed dining + exterior living edge + kitchen on the back edge → true', () => {
    expect(publicStackForDaylightApplies(band, fp, 3.85, 8.8, kitchenBack)).toBe(true);
    expect(publicStackForDaylightApplies(band, fp, 3.85, 8.8, null)).toBe(true);
  });
  it('living-side edge not exterior → false', () => {
    expect(publicStackForDaylightApplies({ ...band, x: 1.5 }, fp, 3.85, 8.8, kitchenBack)).toBe(false);
  });
  it('dining already exterior (band east edge / front / back on the footprint) → false', () => {
    expect(publicStackForDaylightApplies({ ...band, w: 14 }, fp, 3.85, 8.8, null)).toBe(false);
    expect(publicStackForDaylightApplies({ ...band, y: 0 }, fp, 3.85, 8.8, null)).toBe(false);
    expect(publicStackForDaylightApplies({ ...band, h: 12.7 }, fp, 3.85, 12.7, null)).toBe(false);
  });
  it('kitchen touching the legacy dining but not the band back edge → false (contact would be lost)', () => {
    const kitchenEast: Rect = { x: 6.25, y: 2.3, w: 2.0, h: 8.8 };
    expect(publicStackForDaylightApplies(band, fp, 3.85, 8.8, kitchenEast)).toBe(false);
  });
});

describe('Phase 5.4C stackPublicForDaylight — generator / pipeline', () => {
  const B = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
  const site = (w: number, l: number, accessSide: string) => ({
    site: { shape: 'rectangle', width: w, length: l, streetWidth: 9, accessSide, setbackNorth: 2.5, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 },
    building: B, seed: 11, deterministic: true, jurisdiction: 'IR',
  });
  const RECT = site(17.3, 24.6, 'south');
  const RECT_E = site(23.1, 18.7, 'east');
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const cand = (inp: object, strategy: string, opts: object) => generateLayouts(clone(inp) as never, [strategy as never], opts)[0];
  const WATCH = /^CIRC|DIRECT_ACCESS|INACCESSIBLE|DAYLIGHT|DYL/;
  const guarded = (c: LayoutCandidate) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (f.severity === 'hard' || WATCH.test(f.code)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const noAdded = (b: LayoutCandidate, v: LayoutCandidate) => {
    const bc = guarded(b);
    for (const [k, n] of guarded(v)) expect(n, k).toBeLessThanOrEqual(bc.get(k) ?? 0);
  };
  const dyl = (c: LayoutCandidate) => c.findings.filter(f => f.code === 'MBH4-DYL-001').length;

  for (const [name, inp] of [['rect (south access)', RECT], ['rectE (east access)', RECT_E]] as const) {
    it(`${name}: dining gains daylight, no added HARD / circulation / access / daylight finding`, () => {
      const off = cand(inp, 'daylight-orientation', {});
      const on = cand(inp, 'daylight-orientation', { stackPublicForDaylight: true });
      expect(dyl(off)).toBeGreaterThan(0);
      expect(dyl(on)).toBeLessThan(dyl(off));
      expect(on.explanations.some(e => e.startsWith('Phase 5.4C: daylight-aware public-stack variant adopted'))).toBe(true);
      noAdded(off, on);
      expect(on.valid || !off.valid).toBe(true);
      const g = on.floors[0].spaces;
      const L = g.find(s => s.type === 'living')!, D = g.find(s => s.type === 'dining')!, K = g.find(s => s.type === 'kitchen')!, F = g.find(s => s.type === 'foyer')!;
      expect(D.hasExteriorWall).toBe(true);
      expect(L.hasExteriorWall).toBe(true);
      expect(contact(F.rect, L.rect)).toBeGreaterThan(1.0);
      expect(contact(D.rect, K.rect)).toBeGreaterThan(1.0);
    });
  }

  it('non-daylight strategies are unaffected on the same sites', () => {
    for (const inp of [RECT, RECT_E]) for (const st of ['area-efficiency', 'functional-circulation', 'alternative-zoning']) {
      expect(JSON.stringify(cand(inp, st, { stackPublicForDaylight: true }).floors)).toBe(JSON.stringify(cand(inp, st, {}).floors));
    }
  });

  it('adoptPublicStackDaylightVariant: strictly fewer DYL-001, nothing added, validity kept', () => {
    const f = (code: string, severity: Finding['severity'] = 'hard') => ({ code, severity, message: '' }) as Finding;
    const mk = (valid: boolean, findings: Finding[], tag: string) =>
      ({ valid, findings, floors: [{ tag }], explanations: [] }) as unknown as LayoutCandidate;
    const base = mk(false, [f('MBH4-DYL-001'), f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'a');
    expect(adoptPublicStackDaylightVariant(base, mk(true, [f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'b')).floors).toEqual([{ tag: 'b' }]);
    expect(adoptPublicStackDaylightVariant(base, mk(true, [f('ROOM_DAYLIGHT_QUALITY', 'soft'), f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'b'))).toBe(base);
    expect(adoptPublicStackDaylightVariant(base, mk(false, [f('MBH4-DYL-001'), f('ROOM_DAYLIGHT_QUALITY', 'soft')], 'b'))).toBe(base);
    expect(adoptPublicStackDaylightVariant(base, mk(false, [f('CIRC_ROOM_THROUGH_ROOM')], 'b'))).toBe(base);
    expect(adoptPublicStackDaylightVariant(base, mk(false, [f('CONSTRAINT_DIRECT_ACCESS')], 'b'))).toBe(base);
    const validBase = mk(true, [f('MBH4-DYL-001', 'soft')], 'a');
    expect(adoptPublicStackDaylightVariant(validBase, mk(false, [], 'b'))).toBe(validBase);
    expect(adoptPublicStackDaylightVariant(base, mk(true, [], 'a'))).toBe(base);
  });

  it('opt-in generation is deterministic', () => {
    const a = cand(RECT, 'daylight-orientation', { stackPublicForDaylight: true });
    const b = cand(RECT, 'daylight-orientation', { stackPublicForDaylight: true });
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it('interactions: each existing option (and all five) + stack never adds findings over that option alone', () => {
    const others = [
      { preferDiningKitchenAdjacency: true },
      { preferLShapeProgrammeAdjacency: true },
      { galleryDaylightAware: true },
      { connectStairCore: true },
      { programmeDoorCompletion: true },
      { preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true, galleryDaylightAware: true, connectStairCore: true, programmeDoorCompletion: true },
    ];
    for (const inp of [RECT, RECT_E]) for (const st of ['daylight-orientation', 'area-efficiency']) for (const o of others) {
      const alone = cand(inp, st, o);
      const both = cand(inp, st, { ...o, stackPublicForDaylight: true });
      noAdded(alone, both);
      expect(both.valid || !alone.valid).toBe(true);
      expect(dyl(both)).toBeLessThanOrEqual(dyl(alone));
      expect(JSON.stringify(cand(inp, st, { ...o, stackPublicForDaylight: true }).floors)).toBe(JSON.stringify(both.floors));
    }
  });

  it('pipeline default (omitted / false) is byte-identical DXF', () => {
    for (const inp of [RECT, RECT_E]) {
      const omit = generate(createProject(clone(inp) as never)).candidates;
      const off = generate(createProject(clone(inp) as never), { stackPublicForDaylight: false }).candidates;
      expect(off.length).toBe(omit.length);
      off.forEach((c, i) => expect(writeDXF(c)).toBe(writeDXF(omit[i])));
    }
  });
});
