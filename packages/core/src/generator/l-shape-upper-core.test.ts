/**
 * Phase 5.6G — opt-in `lShapeUpperCoreCirculation` (L-shape upper-floor stair-core circulation).
 *
 * On upper floors of L-shape sites the stair-hall spec is withheld from the wing planner and
 * the hall is placed directly on the building's stair CoreAnchor. The planner judges plan
 * circulation from that core (coreSeededCirculationOk) and does not emit a redundant wing
 * spine (redundantWingSpinesDropped). No room / corridor moves after placement. Adopted only
 * through adoptLShapeUpperCoreCirculationVariant. Omitted or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLayouts, adoptLShapeUpperCoreCirculationVariant, L_UPPER_CORE_RESERVED,
  type GenerateLayoutsOptions,
} from './generator.js';
import { coreSeededCirculationOk, redundantWingSpinesDropped, corridorSnapKeepsInside, L_UPPER_CORE_SPINE_SUPPRESSED } from './l-shape.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Space } from '../model/space.js';

const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const CUR: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
  stackedPairMinArea: true, notchShaftCorridorOverlap: true,
};
const ON: GenerateLayoutsOptions = { ...CUR, lShapeUpperCoreCirculation: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const ADOPTED = 'Phase 5.6G: L-shape upper-floor core-circulation variant adopted';
const gen = (inp: ProjectInput, opts: GenerateLayoutsOptions) => generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const snap = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));
const clone = (c: LayoutCandidate): LayoutCandidate => JSON.parse(JSON.stringify(c));
const sp = (id: string, type: string, rect: Rect): Space => ({ id, type, rect } as unknown as Space);

describe('Phase 5.6G — L-shape upper-floor core circulation (lshape/b2 daylight-orientation)', () => {
  for (const seed of [42, 7]) {
    it(`seed ${seed}: 6 HARD → 0 HARD, valid, stair on its anchor, L0 untouched, deterministic`, () => {
      const base = byStrategy(gen(input(LSHAPE, B2, seed), CUR), 'daylight-orientation');
      const on = gen(input(LSHAPE, B2, seed), ON);
      const c = byStrategy(on, 'daylight-orientation');
      expect(hard(base).length).toBe(6);
      expect(hard(c).length).toBe(0);
      expect(c.valid).toBe(true);
      expect(c.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      expect(c.explanations.some(e => e.startsWith(L_UPPER_CORE_RESERVED))).toBe(true);
      expect(c.explanations.some(e => e.startsWith(L_UPPER_CORE_SPINE_SUPPRESSED))).toBe(true);
      // no post-placement stair pin / blocker relocation
      expect(c.explanations.some(e => e.includes('stair-hall pinned to the'))).toBe(false);
      // ground floor identical, stair stacked exactly on the ground-floor hall
      expect(JSON.stringify(c.floors[0])).toBe(JSON.stringify(base.floors[0]));
      const s0 = c.floors[0].spaces.find(s => s.type === 'stair-hall')!.rect;
      const s1 = c.floors[1].spaces.find(s => s.type === 'stair-hall')!;
      expect(s1.rect).toEqual(s0);
      // upper-floor circulation: one corridor system seeded from the stair, every room reached
      const f1 = c.floors[1].spaces;
      const corr = f1.filter(s => s.type === 'corridor');
      expect(corr.length).toBe(1);
      expect(coreSeededCirculationOk(f1.filter(s => s.type !== 'corridor' && s.type !== 'stair-hall'), corr, s1.rect)).toBe(true);
      for (const code of ['CIRC_ROOM_THROUGH_ROOM', 'CIRC_INACCESSIBLE_SPACE', 'CONSTRAINT_MUST_ADJACENT']) expect(hard(c, code).length).toBe(0);
      // daylight findings never grow
      const dyl = (x: LayoutCandidate) => x.findings.filter(f => /DAYLIGHT|DYL/.test(f.code)).length;
      expect(dyl(c)).toBeLessThanOrEqual(dyl(base));
      expect(snap(gen(input(LSHAPE, B2, seed), ON))).toBe(snap(on));
    });
  }

  it('option omitted / false is byte-identical to the legacy output', () => {
    const inp = input(LSHAPE, B2, 42);
    expect(snap(gen(inp, { ...CUR, lShapeUpperCoreCirculation: false }))).toBe(snap(gen(inp, CUR)));
  });

  it('DXF of the adopted candidate stays R12 (AC1009)', () => {
    const c = byStrategy(gen(input(LSHAPE, B2, 42), ON), 'daylight-orientation');
    const dxf = writeDXF(c);
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
  });
});

describe('Phase 5.6G guard — adoptLShapeUpperCoreCirculationVariant', () => {
  const base = byStrategy(gen(input(LSHAPE, B2, 42), CUR), 'daylight-orientation');
  const variant = byStrategy(gen(input(LSHAPE, B2, 42), ON), 'daylight-orientation');
  const fresh = () => {
    const v = clone(variant);
    v.explanations = v.explanations.filter(e => !e.startsWith(ADOPTED));
    return v;
  };

  it('adopts the real variant', () => {
    const v = fresh();
    expect(adoptLShapeUpperCoreCirculationVariant(clone(base), v)).toBe(v);
  });
  it('rejects without the floor-builder marker', () => {
    const v = fresh();
    v.explanations = v.explanations.filter(e => !e.startsWith(L_UPPER_CORE_RESERVED));
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
  it('rejects an added HARD code (through-room)', () => {
    const v = fresh();
    for (let i = 0; i < 1; i++) v.findings.push({ code: 'CIRC_ROOM_THROUGH_ROOM', severity: 'hard', message: 'x', ruleId: 'x', reference: 'x' } as any);
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
  it('rejects an added daylight finding', () => {
    const v = fresh();
    v.findings.push({ code: 'MBH4-DYL-002', severity: 'advisory', message: 'x', ruleId: 'x', reference: 'x' } as any);
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
  it('rejects a changed ground floor', () => {
    const v = fresh();
    v.floors[0].spaces[0].rect = { ...v.floors[0].spaces[0].rect, x: v.floors[0].spaces[0].rect.x + 0.1 };
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
  it('rejects a moved upper-floor stair hall', () => {
    const v = fresh();
    const h = v.floors[1].spaces.find(s => s.type === 'stair-hall')!;
    h.rect = { ...h.rect, y: h.rect.y + 0.5 };
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
  it('rejects a post-placement hall relocation', () => {
    const v = fresh();
    v.explanations.push('Level 1: stair-hall pinned to the 0-floor core anchor for vertical coherence.');
    const b = clone(base);
    expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
  });
});

describe('Phase 5.6G helpers', () => {
  const strip: Rect = { x: 14, y: 5.7, w: 1.5, h: 11.3 };
  const core: Rect = { x: 15.5, y: 5.7, w: 2.5, h: 4.2 };
  const rooms = [
    sp('mb', 'master-bedroom', { x: 8.75, y: 5.7, w: 5.25, h: 4.86 }),
    sp('mbath', 'master-bathroom', { x: 8.75, y: 10.56, w: 5.25, h: 2.14 }),
    sp('bed', 'bedroom', { x: 8.75, y: 12.7, w: 5.25, h: 4 }),
  ];
  const spine = sp('corridor-0', 'corridor', { x: 7.25, y: 5.7, w: 1.5, h: 17.3 });
  const bridge = sp('corridor-bridge', 'corridor', strip);

  it('drops a spine that touches no circulation and whose rooms all open onto the strip', () => {
    expect(redundantWingSpinesDropped(rooms, [spine], strip, core)).toEqual([]);
  });
  it('keeps a spine that a room needs', () => {
    const lonely = [...rooms, sp('b2', 'bedroom', { x: 3, y: 18, w: 4.25, h: 4 })];
    const wing = [spine];
    expect(redundantWingSpinesDropped(lonely, wing, strip, core)).toBe(wing);
  });
  it('keeps a spine that touches the strip or another wing corridor', () => {
    const touching = sp('c1', 'corridor', { x: 12.5, y: 18, w: 1.5, h: 3 });
    const wing = [touching];
    expect(redundantWingSpinesDropped([], wing, { x: 14, y: 17, w: 1.5, h: 5 }, core)).toBe(wing);
    const a = sp('a', 'corridor', { x: 2, y: 18, w: 5, h: 1.5 });
    const b = sp('b', 'corridor', { x: 7, y: 18, w: 1.5, h: 4 });
    const wing2 = [a, b];
    expect(redundantWingSpinesDropped([], wing2, strip, core)).toBe(wing2);
  });
  it('core-seeded circulation: connected plan passes, disconnected spine / core overlap fail', () => {
    expect(coreSeededCirculationOk(rooms, [bridge], core)).toBe(true);
    expect(coreSeededCirculationOk(rooms, [bridge, spine], core)).toBe(false);
    expect(coreSeededCirculationOk([...rooms, sp('x', 'bathroom', { x: 16, y: 6, w: 1, h: 1 })], [bridge], core)).toBe(false);
  });
});

describe('Phase 5.6G weld-stability mirror + oversized-room quality guard', () => {
  const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true } as const;
  const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 } as const;
  const WATCH = /^(CIRC|CIRCULATION|CONSTRAINT_(DIRECT_ACCESS|MUST_ADJACENT)|ROOM_DAYLIGHT|MBH4-DYL)/;
  const watched = (c: LayoutCandidate) => {
    const m = new Map<string, number>();
    for (const f of c.findings) if (WATCH.test(f.code)) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
    return m;
  };
  const bigRooms = (c: LayoutCandidate) => c.floors.flatMap(f => f.spaces).filter(s => s.type !== 'corridor' && s.rect.w * s.rect.h > 60);

  for (const seed of [42, 7]) {
    it(`lshape/b4 functional-circulation seed ${seed}: 10 HARD → 1 HARD, no watched finding added, no relocated room`, () => {
      const base = byStrategy(gen(input(LSHAPE, B4, seed), CUR), 'functional-circulation');
      const c = byStrategy(gen(input(LSHAPE, B4, seed), ON), 'functional-circulation');
      expect(hard(base).length).toBe(10);
      expect(hard(c).length).toBe(1);
      expect(hard(c, 'MBH4-DYL-001').length).toBe(1);
      expect(hard(c, 'CIRC_INACCESSIBLE_SPACE').length).toBe(0);
      expect(hard(c, 'CONSTRAINT_MUST_ADJACENT').length).toBe(0);
      expect(c.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      const bw = watched(base);
      for (const [k, v] of watched(c)) expect(v, k).toBeLessThanOrEqual(bw.get(k) ?? 0);
      expect(JSON.stringify(c.floors[0])).toBe(JSON.stringify(base.floors[0]));
      // the upper-floor bathroom stays in its planned wing, attached to circulation (no snap relocation)
      const l1 = c.floors.find(f => f.level === 1)!;
      const bath = l1.spaces.find(s => s.type === 'bathroom')!;
      const circ = l1.spaces.filter(s => s.type === 'corridor');
      const touch = (a: Rect, b: Rect) => (Math.abs(a.y - (b.y + b.h)) < 1e-6 || Math.abs(b.y - (a.y + a.h)) < 1e-6)
        ? Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        : (Math.abs(a.x - (b.x + b.w)) < 1e-6 || Math.abs(b.x - (a.x + a.w)) < 1e-6) ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : 0;
      expect(circ.some(k => touch(bath.rect, k.rect) >= 0.8)).toBe(true);
      expect(bigRooms(c).length).toBe(bigRooms(base).length);
    });

    it(`lshape/b3lift functional-circulation seed ${seed}: no side effect (oversized room never validated)`, () => {
      const base = byStrategy(gen(input(LSHAPE, B3LIFT, seed), CUR), 'functional-circulation');
      const c = byStrategy(gen(input(LSHAPE, B3LIFT, seed), ON), 'functional-circulation');
      expect(snap([c])).toBe(snap([base]));
      expect(hard(c).length).toBe(4);
      expect(c.valid).toBe(false);
    });
  }

  it('b4 output is deterministic across repeated runs', () => {
    expect(snap(gen(input(LSHAPE, B4, 42), ON))).toBe(snap(gen(input(LSHAPE, B4, 42), ON)));
  });

  it('corridorSnapKeepsInside: a 4 mm pre-weld seam that the snap pushes out of the boundary fails; flush passes; inputs untouched', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 17 }, { x: 0, y: 17 }];
    const corr = sp('c', 'corridor', { x: 0, y: 10.374, w: 4, h: 1.5 });
    const seam = sp('b', 'bathroom', { x: 0, y: 11.87, w: 1.3, h: 5.13 });
    const flush = sp('b', 'bathroom', { x: 0, y: 11.874, w: 1.3, h: 5.126 });
    expect(corridorSnapKeepsInside([seam], [corr], boundary)).toBe(false);
    expect(seam.rect).toEqual({ x: 0, y: 11.87, w: 1.3, h: 5.13 });
    expect(corridorSnapKeepsInside([flush], [corr], boundary)).toBe(true);
    // a seam that stays inside after the snap is fine
    const short = sp('b', 'bathroom', { x: 0, y: 11.87, w: 1.3, h: 4 });
    expect(corridorSnapKeepsInside([short], [corr], boundary)).toBe(true);
  });

  describe('guard clause 11 (quality guard: new oversized room must not make a candidate valid)', () => {
    const base = byStrategy(gen(input(LSHAPE, B2, 42), CUR), 'daylight-orientation');
    const variant = byStrategy(gen(input(LSHAPE, B2, 42), ON), 'daylight-orientation');
    const fresh = () => { const v = clone(variant); v.explanations = v.explanations.filter(e => !e.startsWith(ADOPTED)); return v; };
    const l1 = (c: LayoutCandidate) => c.floors.find(f => f.level === 1)!;
    // one oversized bedroom replacing the upper-floor rooms + corridor column (inside the
    // buildable area, no overlap) so that only clause 11 can decide
    const bigRect = (): Rect => {
      const ss = l1(variant).spaces.filter(s => s.type !== 'stair-hall' && s.type !== 'elevator-hall').map(s => s.rect);
      const x0 = Math.min(...ss.map(r => r.x)), y0 = Math.min(...ss.map(r => r.y));
      const x1 = Math.max(...ss.map(r => r.x + r.w)), y1 = Math.max(...ss.map(r => r.y + r.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const withBig = (c: LayoutCandidate) => {
      const f = l1(c);
      f.spaces = [...f.spaces.filter(s => s.type === 'stair-hall' || s.type === 'elevator-hall'), sp('big-1', 'bedroom', bigRect())];
      return c;
    };
    it('precondition: the real variant is valid and adopted', () => {
      expect(variant.valid).toBe(true);
      expect(adoptLShapeUpperCoreCirculationVariant(clone(base), fresh()).explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      expect(bigRect().w * bigRect().h).toBeGreaterThan(60);
    });
    it('rejects a valid variant that introduces a new > 60 m² room', () => {
      const v = withBig(fresh());
      const b = clone(base);
      expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(b);
    });
    it('control: the same oversized room already present in the base does not trigger the clause', () => {
      const v = withBig(fresh());
      const b = clone(base);
      l1(b).spaces.push(sp('big-1', 'bedroom', bigRect()));
      expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(v);
    });
    it('does not apply to invalid variants', () => {
      const v = withBig(fresh());
      v.valid = false;
      const b = clone(base);
      expect(b.valid).toBe(false);
      expect(adoptLShapeUpperCoreCirculationVariant(b, v)).toBe(v);
    });
  });
});
