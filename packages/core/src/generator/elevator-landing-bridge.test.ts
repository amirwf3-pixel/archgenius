/**
 * Phase 5.6B — opt-in `bridgeElevatorLandingGap` (upper-floor elevator-hall thin-gap bridge).
 *
 * After 5.4D, on upper floors of rectangular sites, an elevator hall left behind an empty
 * gap thinner than CORRIDOR_MIN_WIDTH from the facing corridor is joined to it by the
 * unchanged 5.4D search / split (findThinStairGapBridge): bridge = gap + the corridor's full
 * depth over the hall overlap, remainder pieces kept. The shaft, stair, rooms and anchors
 * never move. Adopted only through adoptElevatorLandingBridgeVariant. Omitted or false must
 * be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { findThinStairGapBridge, generateLayouts, type GenerateLayoutsOptions } from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));
const RECTE_B3LIFT = (seed: number) => input({ ...RECT, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 }, B3LIFT, seed);
const RECT14_B3LIFT = (seed: number) => input({ ...RECT, width: 14, length: 22 }, B3LIFT, seed);
const RECT_B3LIFT = (seed: number) => input(RECT, B3LIFT, seed);
const LSHAPE_B3LIFT = (seed: number) => input({ ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } }, B3LIFT, seed);

const ALL12F: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true,
};
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const gen = (inp: ProjectInput, opts?: GenerateLayoutsOptions) =>
  opts === undefined ? generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS])
    : generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const snap = (cs: LayoutCandidate[]) => JSON.stringify(cs.map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));

const overlapArea = (p: Rect, q: Rect) =>
  Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
const contact = (p: Rect, q: Rect, T = 0.005) => {
  const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
  const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
  if (Math.abs(p.x + p.w - q.x) < T || Math.abs(q.x + q.w - p.x) < T) return Math.max(0, oy);
  if (Math.abs(p.y + p.h - q.y) < T || Math.abs(q.y + q.h - p.y) < T) return Math.max(0, ox);
  return 0;
};
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

// ---------------------------------------------------------------- pure search on elevator geometry
describe('Phase 5.6B bridge search on an elevator hall (unchanged 5.4D search)', () => {
  // rectE/b3lift floor 1: shaft pinned to the core anchor, corridor 0.90 m away.
  const LIFT: Rect = { x: 9.75, y: 12.65, w: 1.95, h: 2.25 };
  const CORR: Rect = { x: 2.74, y: 10.25, w: 8.96, h: 1.5 };
  const BED: Rect = { x: 6.83, y: 11.75, w: 2.92, h: 8.25 };
  const STAIR_BRIDGE: Rect = { x: 11.7, y: 10.25, w: 2.6, h: 2.4 };
  const spaces = (corr = CORR, extra: { type: string; rect: Rect }[] = []) => [
    { type: 'elevator-hall', rect: LIFT }, { type: 'corridor', rect: corr }, { type: 'master-bedroom', rect: BED },
    { type: 'corridor', rect: STAIR_BRIDGE }, ...extra,
  ];
  const inside = () => true;
  it('bridges the 0.90 m gap: gap + full corridor depth over the shaft span, remainder kept', () => {
    const br = findThinStairGapBridge(LIFT, spaces(), inside)!;
    expect(br).not.toBeNull();
    expect(br.corridorIndex).toBe(1);
    expect(br.gap).toBeCloseTo(0.9, 6);
    expect(br.bridge).toEqual({ x: 9.75, y: 10.25, w: expect.closeTo(1.95, 6), h: expect.closeTo(2.4, 6) });
    expect(br.remainders).toHaveLength(1);
    expect(br.remainders[0].w).toBeCloseTo(7.01, 6);
    for (const r of [br.bridge, ...br.remainders]) expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
    expect(contact(br.bridge, LIFT)).toBeCloseTo(1.95, 6);
    for (const o of [BED, STAIR_BRIDGE, LIFT]) expect(overlapArea(br.bridge, o)).toBeLessThan(1e-6);
  });
  it('no-op: gap ≥ CORRIDOR_MIN_WIDTH (5.4B territory)', () => {
    const far = { ...CORR, y: LIFT.y - CORRIDOR_MIN_WIDTH - 1.5 };
    expect(findThinStairGapBridge(LIFT, spaces(far), inside)).toBeNull();
  });
  it('no-op: hall already on the corridor', () => {
    const on = { ...CORR, y: LIFT.y - 1.5 };
    expect(findThinStairGapBridge(LIFT, spaces(on), inside)).toBeNull();
  });
  it('no-op: gap occupied by fixed geometry', () => {
    expect(findThinStairGapBridge(LIFT, spaces(CORR, [{ type: 'storage', rect: { x: 10, y: 11.8, w: 1.2, h: 0.8 } }]), inside)).toBeNull();
  });
  it('no-op: gap or bridge outside the buildable area', () => {
    expect(findThinStairGapBridge(LIFT, spaces(), (r) => r.y + r.h <= 12.0)).toBeNull();
  });
  it('no-op: overlap span shorter than CORRIDOR_MIN_WIDTH', () => {
    const short = { ...CORR, w: LIFT.x + 1.0 - CORR.x };
    expect(findThinStairGapBridge(LIFT, spaces(short), inside)).toBeNull();
  });
  it('no-op: remainder would be a sub-minimum sliver', () => {
    const sliver = { ...CORR, x: LIFT.x - 0.5, w: 0.5 + LIFT.w };
    expect(findThinStairGapBridge(LIFT, spaces(sliver), inside)).toBeNull();
  });
});

// ---------------------------------------------------------------- generator
describe('Phase 5.6B generator (rectE/b3lift daylight-orientation)', () => {
  for (const seed of [42, 7]) {
    it(`seed ${seed}: ELEV_SHAFT_NO_LANDING cleared, valid, geometry guarded`, () => {
      const b = byStrategy(gen(RECTE_B3LIFT(seed), ALL12F), 'daylight-orientation');
      const c = byStrategy(gen(RECTE_B3LIFT(seed), { ...ALL12F, bridgeElevatorLandingGap: true }), 'daylight-orientation');
      expect(hard(b, 'ELEV_SHAFT_NO_LANDING')).toHaveLength(2);
      expect(c.findings.filter(f => f.code === 'ELEV_SHAFT_NO_LANDING')).toHaveLength(0);
      expect(hard(c)).toHaveLength(0);
      expect(c.valid).toBe(true);
      expect(c.explanations.some(e => e.startsWith('Phase 5.6B: elevator-landing bridge variant adopted'))).toBe(true);
      expect(JSON.stringify(c.floors[0])).toBe(JSON.stringify(b.floors[0]));
      const rects = (c as any).buildableRects as Rect[];
      for (const fl of c.floors) {
        const bf = b.floors.find(x => x.level === fl.level)!;
        // rooms, stair and elevator halls unchanged (id + rect)
        const fixed = (f: typeof fl) => f.spaces.filter(s => s.type !== 'corridor').map(s => [s.id, s.type, s.rect]);
        expect(fixed(fl)).toEqual(fixed(bf));
        const lift = fl.spaces.find(s => s.type === 'elevator-hall')!;
        expect(lift.rect).toEqual(c.floors[0].spaces.find(s => s.type === 'elevator-hall')!.rect);
        // real corridor landing: shares ≥ CORRIDOR_MIN_WIDTH of wall with a corridor
        const corr = fl.spaces.filter(s => s.type === 'corridor');
        expect(Math.max(...corr.map(k => contact(lift.rect, k.rect)))).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
        // corridors: minimum width on new pieces, base corridors still covered, inside buildable
        for (const k of corr) {
          const old = bf.spaces.find(o => o.id === k.id && JSON.stringify(o.rect) === JSON.stringify(k.rect));
          if (!old) expect(Math.min(k.rect.w, k.rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
          expect(covered(k.rect, rects)).toBeCloseTo(k.rect.w * k.rect.h, 3);
        }
        for (const k of bf.spaces.filter(s => s.type === 'corridor')) expect(covered(k.rect, corr.map(x => x.rect))).toBeCloseTo(k.rect.w * k.rect.h, 6);
        // no overlaps
        const sp = fl.spaces;
        for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++)
          expect(overlapArea(sp[i].rect, sp[j].rect)).toBeLessThanOrEqual(1e-4);
      }
    });
  }
  it('other strategies of rectE/b3lift unchanged', () => {
    const b = gen(RECTE_B3LIFT(42), ALL12F), c = gen(RECTE_B3LIFT(42), { ...ALL12F, bridgeElevatorLandingGap: true });
    for (const s of ['area-efficiency', 'functional-circulation', 'alternative-zoning'])
      expect(JSON.stringify({ ...byStrategy(c, s), metadata: 0 })).toBe(JSON.stringify({ ...byStrategy(b, s), metadata: 0 }));
  });
  it('lshape/b3lift functional-circulation is unchanged (never worsened)', () => {
    for (const seed of [42, 7]) {
      const b = byStrategy(gen(LSHAPE_B3LIFT(seed), ALL12F), 'functional-circulation');
      const c = byStrategy(gen(LSHAPE_B3LIFT(seed), { ...ALL12F, bridgeElevatorLandingGap: true }), 'functional-circulation');
      expect(hard(c).length).toBeLessThanOrEqual(hard(b).length);
      expect(JSON.stringify({ ...c, metadata: 0 })).toBe(JSON.stringify({ ...b, metadata: 0 }));
    }
  });
  it('no-op where no elevator hall is cut off (rect/b3lift, rect14/b3lift)', () => {
    for (const inp of [RECT_B3LIFT(42), RECT14_B3LIFT(7)])
      expect(snap(gen(inp, { ...ALL12F, bridgeElevatorLandingGap: true }))).toBe(snap(gen(inp, ALL12F)));
  });
  it('deterministic', () => {
    const o = { ...ALL12F, bridgeElevatorLandingGap: true };
    expect(snap(gen(RECTE_B3LIFT(42), o))).toBe(snap(gen(RECTE_B3LIFT(42), o)));
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6B OFF identity', () => {
  it('generateLayouts: option omitted and false are byte-identical', () => {
    for (const inp of [RECTE_B3LIFT(42), RECTE_B3LIFT(7), LSHAPE_B3LIFT(42), RECT14_B3LIFT(42)]) {
      expect(snap(gen(inp, { bridgeElevatorLandingGap: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...ALL12F, bridgeElevatorLandingGap: false }))).toBe(snap(gen(inp, ALL12F)));
    }
  });
  it('pipeline DXF: omitted and false identical; R12 header is only $ACADVER = AC1009', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(RECTE_B3LIFT(42)), { allStrategies: true, topCandidates: 4, ...ALL12F, ...opts });
      return r.candidates.map(c => writeDXF(c, 'QA'));
    };
    const a = dxfs({}), b = dxfs({ bridgeElevatorLandingGap: false }), on = dxfs({ bridgeElevatorLandingGap: true });
    expect(b).toEqual(a);
    expect(on.length).toBeGreaterThan(a.length);
    for (const d of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    }
  });
});
