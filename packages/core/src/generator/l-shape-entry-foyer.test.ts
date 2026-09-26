/**
 * Phase 5.6D — opt-in `alignLShapeEntryFoyer` (L-shape entrance / foyer boundary alignment).
 *
 * On L-shape sites, after wing-plan selection, when the entry band's entrance lies on the
 * living room and the foyer beside it touches living by less than L_CIRC_LINK, the
 * entrance / foyer boundary moves to living's far edge − L_CIRC_LINK
 * (findEntryFoyerAlignment). Only entrance and foyer change. Adopted only through
 * adoptLShapeEntryFoyerVariant. Omitted or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, adoptLShapeEntryFoyerVariant, type GenerateLayoutsOptions } from './generator.js';
import { findEntryFoyerAlignment, L_ENTRY_FOYER_ALIGNED } from './l-shape.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Space } from '../model/space.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B1 = { ...B2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const BEST: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true,
};
const ON: GenerateLayoutsOptions = { ...BEST, alignLShapeEntryFoyer: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const DA = 'CONSTRAINT_DIRECT_ACCESS';
const gen = (inp: ProjectInput, opts?: GenerateLayoutsOptions) =>
  opts === undefined ? generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS])
    : generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const snap = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
const snapOne = (c: LayoutCandidate) => JSON.stringify({ ...c, metadata: { ...c.metadata, generatedAt: 0 } });
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));
const counts = (c: LayoutCandidate) => {
  const m = new Map<string, number>();
  for (const f of c.findings) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
  return m;
};

// ---------------------------------------------------------------- pure alignment
describe('Phase 5.6D findEntryFoyerAlignment (lshape daylight-orientation entry band)', () => {
  const BOUNDARY: Polygon = [{ x: 2, y: 1.5 }, { x: 18, y: 1.5 }, { x: 18, y: 17 }, { x: 14, y: 17 }, { x: 14, y: 23 }, { x: 2, y: 23 }];
  const sp = (id: string, type: string, r: Rect) => ({ id, type, rect: r }) as unknown as Space;
  const EN = sp('entrance-0-001', 'entrance', { x: 2, y: 5.7, w: 5.2286, h: 1.8 });
  const FO = sp('foyer-0-002', 'foyer', { x: 7.2286, y: 5.7, w: 6.7714, h: 1.8 });
  const LV = sp('living-0-003', 'living', { x: 2, y: 7.5, w: 5.25, h: 6.64 });
  const MIN = { minWidth: 1.2, minArea: 2 };

  it('moves the boundary to living far edge − L_CIRC_LINK (6.45): foyer overlaps living by 0.8 m', () => {
    const al = findEntryFoyerAlignment([EN, FO, LV], MIN, BOUNDARY)!;
    expect(al).not.toBeNull();
    expect(al.boundary).toBeCloseTo(6.45, 9);
    expect(al.entrance).toEqual({ x: 2, y: 5.7, w: expect.closeTo(4.45, 9), h: 1.8 });
    expect(al.foyer.x).toBeCloseTo(6.45, 9);
    expect(al.foyer.x + al.foyer.w).toBeCloseTo(14, 9);
    expect(al.foyer.y).toBe(5.7);
    expect(al.foyer.h).toBe(1.8);
  });
  it('mirrored: entrance east of the foyer, living under the entrance', () => {
    const en = sp('e', 'entrance', { x: 8.7714, y: 5.7, w: 5.2286, h: 1.8 });
    const fo = sp('f', 'foyer', { x: 2, y: 5.7, w: 6.7714, h: 1.8 });
    const lv = sp('l', 'living', { x: 8.75, y: 7.5, w: 5.25, h: 6.64 });
    const al = findEntryFoyerAlignment([en, fo, lv], MIN, BOUNDARY)!;
    expect(al.boundary).toBeCloseTo(9.55, 9);
    expect(al.foyer.x + al.foyer.w).toBeCloseTo(9.55, 9);
    expect(al.entrance.x + al.entrance.w).toBeCloseTo(14, 9);
  });
  it('deterministic and pure (inputs untouched)', () => {
    const before = JSON.stringify([EN, FO, LV]);
    expect(findEntryFoyerAlignment([EN, FO, LV], MIN, BOUNDARY)).toEqual(findEntryFoyerAlignment([EN, FO, LV], MIN, BOUNDARY));
    expect(JSON.stringify([EN, FO, LV])).toBe(before);
  });
  it('no-op: foyer already shares ≥ L_CIRC_LINK with living', () => {
    const lv = sp('l', 'living', { x: 2, y: 7.5, w: 6.5, h: 6.64 });
    expect(findEntryFoyerAlignment([EN, FO, lv], MIN, BOUNDARY)).toBeNull();
  });
  it('no-op: entrance not on living', () => {
    const lv = sp('l', 'living', { x: 2, y: 8, w: 5.25, h: 6.64 });
    expect(findEntryFoyerAlignment([EN, FO, lv], MIN, BOUNDARY)).toBeNull();
  });
  it('no-op: entrance and foyer not in the same row', () => {
    const fo = sp('f', 'foyer', { x: 7.2286, y: 5.6, w: 6.7714, h: 1.9 });
    expect(findEntryFoyerAlignment([EN, fo, LV], MIN, BOUNDARY)).toBeNull();
  });
  it('no-op: living narrower than L_CIRC_LINK', () => {
    const lv = sp('l', 'living', { x: 6.6, y: 7.5, w: 0.65, h: 6.64 });
    expect(findEntryFoyerAlignment([EN, FO, lv], MIN, BOUNDARY)).toBeNull();
  });
  it('no-op: entrance would lose its minimum width / area', () => {
    expect(findEntryFoyerAlignment([EN, FO, LV], { minWidth: 4.5, minArea: 2 }, BOUNDARY)).toBeNull();
    expect(findEntryFoyerAlignment([EN, FO, LV], { minWidth: 1.2, minArea: 8.1 }, BOUNDARY)).toBeNull();
  });
  it('no-op: not exactly one entrance / foyer / living', () => {
    expect(findEntryFoyerAlignment([EN, FO], MIN, BOUNDARY)).toBeNull();
    expect(findEntryFoyerAlignment([EN, FO, LV, { ...LV, id: 'living-2' } as Space], MIN, BOUNDARY)).toBeNull();
  });
  it('no-op: rect would leave the buildable boundary', () => {
    const tiny: Polygon = [{ x: 2.5, y: 1.5 }, { x: 18, y: 1.5 }, { x: 18, y: 23 }, { x: 2.5, y: 23 }];
    expect(findEntryFoyerAlignment([EN, FO, LV], MIN, tiny)).toBeNull();
  });
});

// ---------------------------------------------------------------- generator
describe('Phase 5.6D generator (lshape daylight-orientation)', () => {
  const cases: Array<[string, object, number, boolean]> = [];
  for (const seed of [42, 7]) {
    cases.push(['b2', B2, seed, false], ['b3lift', B3LIFT, seed, false], ['b4', B4, seed, true]);
  }
  for (const [name, prog, seed, becomesValid] of cases) {
    it(`${name} seed ${seed}: one ${DA} cleared${becomesValid ? ', becomes valid' : ''}, only entrance / foyer changed`, () => {
      const b = byStrategy(gen(input(LSHAPE, prog, seed), BEST), 'daylight-orientation');
      const c = byStrategy(gen(input(LSHAPE, prog, seed), ON), 'daylight-orientation');
      expect(hard(b, DA)).toHaveLength(1);
      expect(hard(c, DA)).toHaveLength(0);
      expect(b.valid).toBe(false);
      expect(c.valid).toBe(becomesValid);
      // every other finding count identical (soft / advisory included)
      const cb = counts(b), cc = counts(c);
      cb.set(`hard:${DA}`, cb.get(`hard:${DA}`)! - 1);
      if (cb.get(`hard:${DA}`) === 0) cb.delete(`hard:${DA}`);
      expect([...cc].sort()).toEqual([...cb].sort());
      expect(c.explanations.some(e => e.startsWith('Phase 5.6D: L-shape entrance / foyer alignment variant adopted'))).toBe(true);
      // geometry: entrance / foyer moved; others within one 0.01 m weld step; halls identical
      for (const fb of b.floors) {
        const fc = c.floors.find(f => f.level === fb.level)!;
        expect(fc.spaces.length).toBe(fb.spaces.length);
        for (const s of fb.spaces) {
          const v = fc.spaces.find(x => x.id === s.id)!;
          expect(v.type).toBe(s.type);
          expect(v.hasExteriorWall).toBe(s.hasExteriorWall);
          if (s.type === 'entrance' || s.type === 'foyer') continue;
          if (s.type === 'stair-hall' || s.type === 'elevator-hall') { expect(v.rect).toEqual(s.rect); continue; }
          for (const k of ['x', 'y', 'w', 'h'] as const) expect(Math.abs(v.rect[k] - s.rect[k])).toBeLessThanOrEqual(0.01 + E);
        }
      }
      const en = c.floors[0].spaces.find(s => s.type === 'entrance')!;
      const fo = c.floors[0].spaces.find(s => s.type === 'foyer')!;
      expect(en.rect.x + en.rect.w).toBeCloseTo(fo.rect.x, 6);
      expect(Math.min(en.rect.w, en.rect.h)).toBeGreaterThanOrEqual(1.2 - E);
      expect(en.area).toBeGreaterThanOrEqual(en.minArea - E);
    });
  }
  it('other L-shape strategies / programmes unchanged', () => {
    for (const prog of [B1, B2, B3LIFT, B4]) for (const seed of [42, 7]) {
      const b = gen(input(LSHAPE, prog, seed), BEST), c = gen(input(LSHAPE, prog, seed), ON);
      for (const s of STRATS) {
        if (prog !== B1 && s === 'daylight-orientation') continue;
        expect(snapOne(byStrategy(c, s))).toBe(snapOne(byStrategy(b, s)));
      }
    }
  });
  it('no-op on rectangular sites', () => {
    for (const site of [RECT, { ...RECT, width: 14, length: 22 }]) {
      const inp = input(site, B2, 42);
      expect(snap(gen(inp, ON))).toBe(snap(gen(inp, BEST)));
    }
  });
  it('deterministic', () => {
    const inp = input(LSHAPE, B4, 42);
    expect(snap(gen(inp, ON))).toBe(snap(gen(inp, ON)));
  });
});

// ---------------------------------------------------------------- guard
describe('Phase 5.6D adoptLShapeEntryFoyerVariant guard', () => {
  const base = () => byStrategy(gen(input(LSHAPE, B4, 42), BEST), 'daylight-orientation');
  const variant = () => {
    const c = byStrategy(gen(input(LSHAPE, B4, 42), ON), 'daylight-orientation');
    // strip the adoption line: the guard sees the raw variant with the placer marker
    c.explanations = c.explanations.filter(e => !e.startsWith('Phase 5.6D:'));
    if (!c.explanations.some(e => e.startsWith(L_ENTRY_FOYER_ALIGNED))) c.explanations.push(`${L_ENTRY_FOYER_ALIGNED}: test`);
    return c;
  };
  it('adopts the real variant', () => {
    const b = base(), v = variant();
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(v);
  });
  it('rejects without the placer marker', () => {
    const b = base(), v = variant();
    v.explanations = v.explanations.filter(e => !e.startsWith(L_ENTRY_FOYER_ALIGNED));
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(b);
  });
  it('rejects when DA does not decrease (identical candidate)', () => {
    const b = base(), v = base();
    v.explanations.push(`${L_ENTRY_FOYER_ALIGNED}: test`);
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(b);
  });
  it('rejects a new HARD code', () => {
    const b = base(), v = variant();
    v.findings.push({ ...hard(b, DA)[0], code: 'TEST_NEW_HARD' });
    v.findings.push({ ...hard(b, DA)[0], code: 'TEST_NEW_HARD_2' });
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(b);
  });
  it('rejects a moved stair hall / non-entry space beyond one weld step / exterior-wall change', () => {
    const b = base();
    const moveBy = (type: string, d: number) => {
      const v = variant();
      const s = v.floors[0].spaces.find(x => x.type === type)!;
      s.rect = { ...s.rect, y: s.rect.y + d };
      return v;
    };
    expect(adoptLShapeEntryFoyerVariant(b, moveBy('stair-hall', 0.001))).toBe(b);
    expect(adoptLShapeEntryFoyerVariant(b, moveBy('kitchen', 0.05))).toBe(b);
    const v = variant();
    const k = v.floors[0].spaces.find(x => x.type === 'kitchen')!;
    k.hasExteriorWall = !k.hasExteriorWall;
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(b);
  });
  it('rejects an entrance whose short side shrinks', () => {
    const b = base(), v = variant();
    const en = v.floors[0].spaces.find(x => x.type === 'entrance')!;
    en.rect = { ...en.rect, h: en.rect.h - 0.1 };
    expect(adoptLShapeEntryFoyerVariant(b, v)).toBe(b);
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6D OFF identity', () => {
  it('generateLayouts: option omitted and false are byte-identical', () => {
    for (const inp of [input(LSHAPE, B4, 42), input(LSHAPE, B2, 7), input(RECT, B2, 42)]) {
      expect(snap(gen(inp, { alignLShapeEntryFoyer: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...BEST, alignLShapeEntryFoyer: false }))).toBe(snap(gen(inp, BEST)));
    }
  });
  it('pipeline DXF: omitted and false identical; R12 header is only $ACADVER = AC1009', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(input(LSHAPE, B4, 42)), { allStrategies: true, topCandidates: 4, ...BEST, ...opts });
      return r.candidates.map(c => writeDXF(c, 'QA'));
    };
    const a = dxfs({}), b = dxfs({ alignLShapeEntryFoyer: false }), on = dxfs({ alignLShapeEntryFoyer: true });
    expect(b).toEqual(a);
    expect(on).not.toEqual(a);
    for (const d of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    }
  });
});
