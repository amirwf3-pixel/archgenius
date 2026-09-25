/**
 * Phase 5.6A — opt-in `upperFloorFrontPrivate` (Class A: upper-floor private band too small).
 *
 * On an upper floor of a rectangular site with a horizontal / L-spur corridor and no public
 * or semi-private programme, when the existing Phase 13 side-by-side check says the private
 * band behind the corridor cannot host its clusters, the minimum number of trailing clusters
 * (order kept) moves to the empty front zone across the corridor, every room touching it.
 * The generator adopts the variant only through adoptUpperFloorFrontPrivateVariant. Omitted
 * or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  placeSpaces, upperFloorFrontPrivateSplit, UPPER_FLOOR_FRONT_PRIVATE_APPLIED,
  type FrontSplitGroup, type PlacedSpec,
} from './placer.js';
import { generateLayouts, type GenerateLayoutsOptions } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Space, SpaceType } from '../model/space.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;

// ---------------------------------------------------------------- fixtures (benchmark grid)
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));
const RECT14_B4 = (seed: number) => input({ ...RECT, width: 14, length: 22 }, B4, seed);
const LSHAPE_B4 = (seed: number) => input({ ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } }, B4, seed);
const RECT_B2 = (seed: number) => input(RECT, B2, seed);
const RECTE_B4 = (seed: number) => input({ ...RECT, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 }, B4, seed);

const ALL12: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
};
const TARGETS = ['area-efficiency', 'functional-circulation', 'alternative-zoning'] as const;
const ALL_STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;

const gen = (inp: ProjectInput, opts?: GenerateLayoutsOptions) =>
  opts === undefined ? generateLayouts(JSON.parse(JSON.stringify(inp)), [...ALL_STRATS])
    : generateLayouts(JSON.parse(JSON.stringify(inp)), [...ALL_STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
/** Candidate content without the wall-clock timestamp. */
const snap = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));

const overlapArea = (p: Rect, q: Rect) =>
  Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
/**
 * Length of shared wall between two touching rects (0 when they don't touch). `T` is the
 * edge tolerance: 0.005 on generator output; 0.011 on raw placer output, whose rooms are
 * snapped to the 1 cm grid while the corridor edge is not (legacy rounding — the stair hall
 * shows the same offset; the placer's own contact check uses the same 0.011).
 */
const contact = (p: Rect, q: Rect, T = 0.005) => {
  const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  if (Math.abs(p.x + p.w - q.x) < T || Math.abs(q.x + q.w - p.x) < T) return Math.max(0, oy);
  if (Math.abs(p.y + p.h - q.y) < T || Math.abs(q.y + q.h - p.y) < T) return Math.max(0, ox);
  return 0;
};
/** Exact union coverage of r by rects (coordinate compression). */
const covered = (r: Rect, rects: Rect[]) => {
  const c = rects.map(b => ({ x0: Math.max(r.x, b.x), y0: Math.max(r.y, b.y), x1: Math.min(r.x + r.w, b.x + b.w), y1: Math.min(r.y + r.h, b.y + b.h) }))
    .filter(k => k.x1 > k.x0 && k.y1 > k.y0);
  const xs = [...new Set(c.flatMap(k => [k.x0, k.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(c.flatMap(k => [k.y0, k.y1]))].sort((a, b) => a - b);
  let a = 0;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    if (c.some(k => cx > k.x0 && cx < k.x1 && cy > k.y0 && cy < k.y1)) a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  }
  return a;
};
const PRIVATE = new Set(['master-bedroom', 'master-bathroom', 'bedroom', 'bathroom']);

// ---------------------------------------------------------------- pure split
describe('Phase 5.6A upperFloorFrontPrivateSplit (pure)', () => {
  // rect14/b4 floor 1: master suite, bedroom + bath pair, single bedroom (Phase 13 minimums).
  const G: FrontSplitGroup[] = [
    { minWidths: [1.5, 2.8], minDepths: [1.5, 2.8] },
    { minWidths: [2.5, 1.3], minDepths: [2.5, 1.3] },
    { minWidths: [2.5], minDepths: [2.5] },
  ];
  it('rect14/b4: moves the minimum 2 trailing groups (one group is not enough)', () => {
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6.565 }, { w: 10, h: 5.235 })).toBe(2);
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 5.235 }, { w: 8.1, h: 6.565 })).toBe(2);
  });
  it('moves only one group when that already fits both sides', () => {
    expect(upperFloorFrontPrivateSplit(G, { w: 8.1, h: 6 }, { w: 10, h: 5 })).toBe(1);
  });
  it('null: band already feasible', () => {
    expect(upperFloorFrontPrivateSplit(G, { w: 10.6, h: 6 }, { w: 10, h: 5 })).toBeNull();
  });
  it('null: insufficient front zone (width or depth)', () => {
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6.5 }, { w: 6.0, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6.5 }, { w: 10, h: 2.4 })).toBeNull();
  });
  it('null: invalid input', () => {
    expect(upperFloorFrontPrivateSplit([], { w: 7, h: 6 }, { w: 10, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit([G[0]], { w: 1, h: 6 }, { w: 10, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit(G, { w: NaN, h: 6 }, { w: 10, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6 }, { w: 0, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit([...G, { minWidths: [2], minDepths: [] }], { w: 7.4, h: 6 }, { w: 10, h: 5 })).toBeNull();
    expect(upperFloorFrontPrivateSplit([...G, { minWidths: [-1], minDepths: [2] }], { w: 7.4, h: 6 }, { w: 10, h: 5 })).toBeNull();
  });
  it('deterministic', () => {
    const a = upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6.565 }, { w: 10, h: 5.235 });
    expect(upperFloorFrontPrivateSplit(G, { w: 7.4, h: 6.565 }, { w: 10, h: 5.235 })).toBe(a);
  });
});

// ---------------------------------------------------------------- placer
/** rect14/b4 floor 1 (upper floor): stair, corridor and the private programme only. */
const spec = (type: SpaceType, minWidth: number, minArea: number, targetArea: number, n: number): PlacedSpec =>
  ({ type, minWidth, minArea, targetArea, placedId: `${type}-1-${n}`, placedLabel: `${type} ${n}` } as unknown as PlacedSpec);
const UPPER: PlacedSpec[] = [
  spec('stair-hall', 1.2, 4.5, 6, 0), spec('corridor', 1.1, 1.5, 4, 1),
  spec('master-bedroom', 2.8, 12, 16, 2), spec('master-bathroom', 1.5, 3.4, 5, 3),
  spec('bedroom', 2.5, 9, 12, 4), spec('bedroom', 2.5, 9, 12, 5), spec('bathroom', 1.3, 2.4, 3.6, 6),
];
const FOOT: Rect = { x: 2, y: 5.7, w: 10, h: 13.3 };
const mk = (type: SpaceType, r: Rect, label: string, id: string, zone: string): Space =>
  ({ id, type, label, zone, rect: { ...r }, polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], area: r.w * r.h } as unknown as Space);
const place = (specs: PlacedSpec[], strategy: typeof ALL_STRATS[number], on: boolean | undefined, foot = FOOT) =>
  on === undefined ? placeSpaces(foot, specs.map(s => ({ ...s })), strategy, 'south', mk)
    : placeSpaces(foot, specs.map(s => ({ ...s })), strategy, 'south', mk, { upperFloorFrontPrivate: on });

describe('Phase 5.6A placer', () => {
  for (const strategy of TARGETS) {
    it(`${strategy}: splits the rect14/b4 upper floor; every room touches the corridor, none overlap`, () => {
      const legacy = place(UPPER, strategy, undefined);
      const r = place(UPPER, strategy, true);
      expect(legacy.explanation.some(e => e.includes('CAPACITY_INFEASIBLE_BAND'))).toBe(true);
      expect(r.explanation.some(e => e.startsWith(UPPER_FLOOR_FRONT_PRIVATE_APPLIED))).toBe(true);
      const rooms = r.spaces.filter(s => PRIVATE.has(s.type));
      expect(rooms.map(s => s.type).sort()).toEqual(UPPER.filter(s => PRIVATE.has(s.type)).map(s => s.type).sort());
      const corr = r.corridors[0].rect;
      expect(corr).toEqual(legacy.corridors[0].rect);
      for (const s of rooms) {
        expect(contact(s.rect, corr, 0.011)).toBeGreaterThanOrEqual(0.9 - E);
        const sp = UPPER.find(x => x.placedId === s.id)!;
        expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual((sp.minWidth ?? 0) - 0.05);
        expect(s.area).toBeGreaterThanOrEqual((sp.minArea ?? 0) - 0.1);
      }
      // moved groups (front, street side) keep programme order: the bedroom + bath pair, then the single bedroom
      const front = rooms.filter(s => s.rect.y + s.rect.h <= corr.y + 0.01).sort((a, b) => a.rect.x - b.rect.x);
      expect(front.map(s => s.type)).toEqual(['bedroom', 'bathroom', 'bedroom']);
      const all = [...r.spaces, ...r.corridors];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
        expect(overlapArea(all[i].rect, all[j].rect)).toBeLessThan(0.02 * 0.02 + 0.05);
      // stair hall unchanged
      expect(r.spaces.find(s => s.type === 'stair-hall')!.rect).toEqual(legacy.spaces.find(s => s.type === 'stair-hall')!.rect);
    });
  }
  it('no-op: option omitted / false are identical', () => {
    for (const strategy of ALL_STRATS) {
      expect(JSON.stringify(place(UPPER, strategy, false))).toBe(JSON.stringify(place(UPPER, strategy, undefined)));
    }
  });
  it('no-op: vertical spine (daylight-orientation)', () => {
    expect(JSON.stringify(place(UPPER, 'daylight-orientation', true))).toBe(JSON.stringify(place(UPPER, 'daylight-orientation', undefined)));
  });
  it('no-op: floor with public programme', () => {
    const withLiving = [...UPPER, spec('living', 3, 12, 18, 9)];
    const withDining = [...UPPER, spec('dining', 2.4, 7, 10, 9)];
    for (const specs of [withLiving, withDining]) for (const strategy of TARGETS) {
      const r = place(specs, strategy, true);
      expect(r.explanation.some(e => e.startsWith(UPPER_FLOOR_FRONT_PRIVATE_APPLIED))).toBe(false);
      expect(JSON.stringify(r)).toBe(JSON.stringify(place(specs, strategy, undefined)));
    }
  });
  it('no-op: already-feasible band', () => {
    const small = UPPER.filter(s => s.placedId !== 'bedroom-1-5' && s.placedId !== 'bathroom-1-6');
    for (const strategy of TARGETS) {
      const r = place(small, strategy, true);
      expect(r.explanation.some(e => e.startsWith(UPPER_FLOOR_FRONT_PRIVATE_APPLIED))).toBe(false);
      expect(JSON.stringify(r)).toBe(JSON.stringify(place(small, strategy, undefined)));
    }
  });
  it('no-op: insufficient front zone', () => {
    const big = [...UPPER, spec('bedroom', 2.5, 9, 12, 7), spec('bedroom', 2.5, 9, 12, 8), spec('bedroom', 2.5, 9, 12, 10), spec('master-bedroom', 2.8, 12, 16, 11)];
    for (const strategy of TARGETS) {
      const r = place(big, strategy, true);
      expect(r.explanation.some(e => e.startsWith(UPPER_FLOOR_FRONT_PRIVATE_APPLIED))).toBe(false);
      expect(JSON.stringify(r)).toBe(JSON.stringify(place(big, strategy, undefined)));
    }
  });
});

// ---------------------------------------------------------------- generator
describe('Phase 5.6A generator (rect14/b4 benchmark cases)', () => {
  for (const seed of [42, 7]) {
    const base = gen(RECT14_B4(seed), ALL12);
    const v = gen(RECT14_B4(seed), { ...ALL12, upperFloorFrontPrivate: true });
    for (const strategy of TARGETS) {
      it(`seed ${seed} ${strategy}: ARCH_PROGRAM_UNPLACED cleared, valid, geometry guarded`, () => {
        const b = byStrategy(base, strategy), c = byStrategy(v, strategy);
        expect(b.findings.some(f => f.severity === 'hard' && f.code === 'ARCH_PROGRAM_UNPLACED')).toBe(true);
        expect(c.findings.filter(f => f.code === 'ARCH_PROGRAM_UNPLACED')).toHaveLength(0);
        expect(c.findings.filter(f => f.severity === 'hard')).toHaveLength(0);
        expect(c.valid).toBe(true);
        expect(c.explanations.some(e => e.startsWith('Phase 5.6A: upper-floor front private split adopted'))).toBe(true);
        // ground floor identical
        expect(JSON.stringify(c.floors[0])).toBe(JSON.stringify(b.floors[0]));
        const g0 = c.floors[0].spaces.map(s => s.rect);
        const rects = (c as any).buildableRects as Rect[];
        const f1 = c.floors[1], b1 = b.floors[1];
        // stair hall unchanged; corridor not shortened (final corridors cover the base corridors)
        expect(f1.spaces.filter(s => s.type === 'stair-hall').map(s => s.rect)).toEqual(b1.spaces.filter(s => s.type === 'stair-hall').map(s => s.rect));
        const vCorr = f1.spaces.filter(s => s.type === 'corridor').map(s => s.rect);
        for (const k of b1.spaces.filter(s => s.type === 'corridor')) expect(covered(k.rect, vCorr)).toBeCloseTo(k.rect.w * k.rect.h, 6);
        const main = [...vCorr].sort((p, q) => Math.max(q.w, q.h) - Math.max(p.w, p.h))[0];
        const rooms = f1.spaces.filter(s => PRIVATE.has(s.type));
        expect(rooms).toHaveLength(5);
        const front = rooms.filter(s => s.rect.y + s.rect.h <= main.y + 0.01);
        expect(front.map(s => s.type).sort()).toEqual(['bathroom', 'bedroom', 'bedroom']);
        for (const s of rooms) {
          // every private room touches a corridor
          expect(Math.max(...vCorr.map(k => contact(s.rect, k)))).toBeGreaterThanOrEqual(0.9 - E);
          // programme minimums
          expect(Math.min(s.rect.w, s.rect.h)).toBeGreaterThanOrEqual((s.minWidth ?? 0) - 0.05);
          expect(s.area).toBeGreaterThanOrEqual((s.minArea ?? 0) - 0.1);
          // inside the buildable area
          expect(covered(s.rect, rects)).toBeCloseTo(s.rect.w * s.rect.h, 3);
        }
        // front rooms are over ground-floor geometry (no overhang on the street side)
        for (const s of front) expect(covered(s.rect, g0)).toBeCloseTo(s.rect.w * s.rect.h, 3);
        // no overlaps on any floor
        for (const fl of c.floors) {
          const sp = fl.spaces;
          for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++)
            expect(overlapArea(sp[i].rect, sp[j].rect)).toBeLessThanOrEqual(1e-4 + 0.02);
        }
      });
    }
    it(`seed ${seed} daylight-orientation control unchanged`, () => {
      const b = byStrategy(base, 'daylight-orientation'), c = byStrategy(v, 'daylight-orientation');
      expect(JSON.stringify({ ...c, metadata: 0 })).toBe(JSON.stringify({ ...b, metadata: 0 }));
    });
  }

  it('deterministic', () => {
    const a = gen(RECT14_B4(42), { ...ALL12, upperFloorFrontPrivate: true });
    const b = gen(RECT14_B4(42), { ...ALL12, upperFloorFrontPrivate: true });
    expect(snap(a)).toBe(snap(b));
  });

  it('no-op on L-shape sites and on floors that already fit (rect/b2, rectE/b4)', () => {
    for (const inp of [LSHAPE_B4(42), RECT_B2(42), RECTE_B4(7)]) {
      expect(snap(gen(inp, { ...ALL12, upperFloorFrontPrivate: true }))).toBe(snap(gen(inp, ALL12)));
      expect(snap(gen(inp, { upperFloorFrontPrivate: true }))).toBe(snap(gen(inp)));
    }
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6A OFF identity', () => {
  it('generateLayouts: option omitted and false are byte-identical', () => {
    for (const inp of [RECT14_B4(42), RECT14_B4(7), RECT_B2(7), LSHAPE_B4(7)]) {
      expect(snap(gen(inp, { upperFloorFrontPrivate: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...ALL12, upperFloorFrontPrivate: false }))).toBe(snap(gen(inp, ALL12)));
    }
  });
  it('pipeline DXF: omitted and false identical; R12 header is only $ACADVER = AC1009', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(RECT14_B4(42)), { allStrategies: true, topCandidates: 4, ...ALL12, ...opts });
      return r.candidates.map(c => writeDXF(c, 'QA'));
    };
    const a = dxfs({}), b = dxfs({ upperFloorFrontPrivate: false }), on = dxfs({ upperFloorFrontPrivate: true });
    expect(b).toEqual(a);
    expect(on.length).toBeGreaterThan(a.length);
    for (const d of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    }
  });
});
