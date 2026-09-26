/**
 * Phase 5.6E — opt-in `stackedPairMinArea` (stacked-pair minArea cap).
 *
 * In the rectangular placer's Phase 13 generic column fallback, a two-room stacked pair
 * (master bath first, master bedroom second) sizes the first room by the legacy bath-strip
 * heuristic without checking the second room's minArea. With the option, the first room's
 * depth is capped (snapped down to 0.01 m) so the second keeps its spec minArea — only when
 * the first keeps its own minimum depth / minArea. Adopted only through
 * adoptStackedPairMinAreaVariant. Omitted or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, adoptStackedPairMinAreaVariant, type GenerateLayoutsOptions } from './generator.js';
import { STACKED_PAIR_MIN_AREA_APPLIED } from '../layout/placer.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const RECT14 = { ...RECT, width: 14, length: 22 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const BEST: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
};
const ON: GenerateLayoutsOptions = { ...BEST, stackedPairMinArea: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const RULE = 'ROOM_CONSTRAINT_MIN_AREA';
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
const ADOPTED = 'Phase 5.6E: stacked-pair minArea variant adopted';
const clone = (c: LayoutCandidate): LayoutCandidate => JSON.parse(JSON.stringify(c));

// ---------------------------------------------------------------- generator
describe('Phase 5.6E generator (rect14/b3lift functional-circulation)', () => {
  for (const seed of [42, 7]) {
    it(`seed ${seed}: master bedroom reaches minArea, candidate becomes valid, only the master suite boundary moves`, () => {
      const b = byStrategy(gen(input(RECT14, B3LIFT, seed), BEST), 'functional-circulation');
      const c = byStrategy(gen(input(RECT14, B3LIFT, seed), ON), 'functional-circulation');
      expect(b.valid).toBe(false);
      expect(hard(b).map(f => f.code).sort()).toEqual(['MBH4-ROOM-001', RULE, RULE]);
      expect(c.valid).toBe(true);
      expect(hard(c)).toHaveLength(0);
      expect(c.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      // findings: only the three HARDs and one soft MBH4-ROOM-001 go away; nothing is added
      const cb = counts(b), cc = counts(c);
      for (const [k, n] of cc) expect(n).toBeLessThanOrEqual(cb.get(k) ?? 0);
      cb.delete(`hard:${RULE}`); cb.delete('hard:MBH4-ROOM-001');
      cb.set('soft:MBH4-ROOM-001', cb.get('soft:MBH4-ROOM-001')! - 1);
      expect([...cc].sort()).toEqual([...cb].sort());
      // geometry: every space identical except the stacked master bath / master bedroom
      for (const fb of b.floors) {
        const fc = c.floors.find(f => f.level === fb.level)!;
        expect(fc.spaces.map(s => s.id)).toEqual(fb.spaces.map(s => s.id));
        for (const s of fb.spaces) {
          const v = fc.spaces.find(x => x.id === s.id)!;
          expect(v.hasExteriorWall).toBe(s.hasExteriorWall);
          if (fb.level === 1 && (s.type === 'master-bathroom' || s.type === 'master-bedroom')) continue;
          expect(v.rect).toEqual(s.rect);
        }
      }
      const f0 = b.floors[1], f1 = c.floors[1];
      const bb = f0.spaces.find(s => s.type === 'master-bathroom')!, bm = f0.spaces.find(s => s.type === 'master-bedroom')!;
      const vb = f1.spaces.find(s => s.type === 'master-bathroom')!, vm = f1.spaces.find(s => s.type === 'master-bedroom')!;
      expect(bm.area).toBeLessThan(bm.minArea);
      // same x / width, outer edges fixed, shared boundary moved toward the bath
      for (const [s, v] of [[bb, vb], [bm, vm]] as const) { expect(v.rect.x).toBe(s.rect.x); expect(v.rect.w).toBe(s.rect.w); }
      expect(vb.rect.y).toBe(bb.rect.y);
      expect(vm.rect.y + vm.rect.h).toBeCloseTo(bm.rect.y + bm.rect.h, 9);
      expect(vb.rect.y + vb.rect.h).toBeCloseTo(vm.rect.y, 9);
      expect(vm.rect.y).toBeLessThan(bm.rect.y);
      expect(vm.area).toBeGreaterThanOrEqual(vm.minArea - E);
      expect(vb.area).toBeGreaterThanOrEqual(vb.minArea - E);
      expect(Math.min(vb.rect.w, vb.rect.h)).toBeGreaterThanOrEqual((vb.minWidth ?? 0) - E);
      expect(Math.min(vm.rect.w, vm.rect.h)).toBeGreaterThanOrEqual((vm.minWidth ?? 0) - E);
      // openings: same count everywhere; only the suite door moved, with the boundary
      for (const fb of b.floors) {
        const fc = c.floors.find(f => f.level === fb.level)!;
        expect(fc.openings.length).toBe(fb.openings.length);
        fb.openings.forEach((o, i) => {
          const v = fc.openings[i];
          const suite = o.type === 'door' && [o.spaceA, o.spaceB].sort().join() === [bb.id, bm.id].sort().join();
          if (!suite) { expect(v).toEqual(o); return; }
          expect({ ...v, center: 0, hinge: 0, leafEnd: 0, openEnd: 0 }).toEqual({ ...o, center: 0, hinge: 0, leafEnd: 0, openEnd: 0 });
          expect(v.center.x).toBeCloseTo(o.center.x, 9);
          expect(v.center.y - o.center.y).toBeCloseTo(vm.rect.y - bm.rect.y, 9);
        });
      }
    });
  }
  it('alternative-zoning: cap infeasible (bath would drop below its minimum depth) — unchanged', () => {
    for (const seed of [42, 7]) {
      const b = byStrategy(gen(input(RECT14, B3LIFT, seed), BEST), 'alternative-zoning');
      const c = byStrategy(gen(input(RECT14, B3LIFT, seed), ON), 'alternative-zoning');
      expect(hard(c, RULE).length).toBe(hard(b, RULE).length);
      expect(c.floors).toEqual(b.floors);
      expect(c.findings).toEqual(b.findings);
    }
  });
  it('other candidates unchanged (guard never adopts elsewhere)', () => {
    const cases: Array<[object, object]> = [[RECT, B2], [RECT, B4], [RECT14, B2], [RECT14, B4], [LSHAPE, B4]];
    for (const [site, prog] of cases) {
      const inp = input(site, prog, 42);
      expect(snap(gen(inp, ON))).toBe(snap(gen(inp, BEST)));
    }
    const b = gen(input(RECT14, B3LIFT, 42), BEST), c = gen(input(RECT14, B3LIFT, 42), ON);
    for (const s of ['area-efficiency', 'daylight-orientation']) expect(snapOne(byStrategy(c, s))).toBe(snapOne(byStrategy(b, s)));
  });
  it('deterministic', () => {
    const inp = input(RECT14, B3LIFT, 42);
    expect(snap(gen(inp, ON))).toBe(snap(gen(inp, ON)));
  });
});

// ---------------------------------------------------------------- guard
describe('Phase 5.6E adoptStackedPairMinAreaVariant guard', () => {
  const pair = () => {
    const base = byStrategy(gen(input(RECT14, B3LIFT, 42), BEST), 'functional-circulation');
    const adopted = byStrategy(gen(input(RECT14, B3LIFT, 42), ON), 'functional-circulation');
    const variant = clone(adopted);
    variant.explanations = variant.explanations.filter(e => !e.startsWith('Phase 5.6E:'));
    return { base, variant };
  };
  const spaceOf = (c: LayoutCandidate, type: string) => c.floors[1].spaces.find(s => s.type === type)!;

  it('adopts the real variant (marker present)', () => {
    const { base, variant } = pair();
    expect(variant.explanations.some(e => e.includes(STACKED_PAIR_MIN_AREA_APPLIED))).toBe(true);
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(variant);
  });
  it('1: rejects without the placer marker', () => {
    const { base, variant } = pair();
    variant.explanations = variant.explanations.filter(e => !e.includes(STACKED_PAIR_MIN_AREA_APPLIED));
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
  });
  it('3: rejects when ROOM_CONSTRAINT_MIN_AREA does not decrease', () => {
    const { base } = pair();
    const v = clone(base);
    v.explanations.push(`${STACKED_PAIR_MIN_AREA_APPLIED}: test`);
    expect(adoptStackedPairMinAreaVariant(base, v)).toBe(base);
  });
  it('5/6: rejects a new HARD code or a new circulation finding', () => {
    const { base, variant } = pair();
    const tpl = hard(base, RULE)[0];
    variant.findings.push({ ...tpl, code: 'TEST_NEW_HARD' });
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    const p2 = pair();
    p2.variant.findings.push({ ...tpl, severity: 'soft', code: 'CIRC_TEST' });
    expect(adoptStackedPairMinAreaVariant(p2.base, p2.variant)).toBe(p2.base);
  });
  it('7: rejects a third changed space or a moved outer edge / x / width', () => {
    let { base, variant } = pair();
    const bd = spaceOf(variant, 'bedroom');
    bd.rect = { ...bd.rect, h: bd.rect.h - 0.01 };
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    const mb = spaceOf(variant, 'master-bedroom');
    mb.rect = { ...mb.rect, h: mb.rect.h - 0.01 };
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    for (const t of ['master-bedroom', 'master-bathroom']) { const s = spaceOf(variant, t); s.rect = { ...s.rect, x: s.rect.x + 0.01 }; }
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
  });
  it('8: rejects a room below its minArea', () => {
    const { base, variant } = pair();
    const bt = spaceOf(variant, 'master-bathroom');
    bt.area = bt.minArea - 0.01;
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
  });
  it('9: rejects a moved stair hall / elevator hall / corridor', () => {
    for (const t of ['stair-hall', 'elevator-hall', 'corridor']) {
      const { base, variant } = pair();
      const s = spaceOf(variant, t);
      s.rect = { ...s.rect, y: s.rect.y + 0.01 };
      expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    }
  });
  it('10: rejects any other changed opening, or the suite door not translated by the boundary shift', () => {
    let { base, variant } = pair();
    const other = variant.floors[1].openings.find(o => !(o.type === 'door' && [o.spaceA, o.spaceB].includes(spaceOf(variant, 'master-bathroom').id)))!;
    other.width += 0.01;
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    const bt = spaceOf(variant, 'master-bathroom').id, mb = spaceOf(variant, 'master-bedroom').id;
    const door = variant.floors[1].openings.find(o => o.type === 'door' && [o.spaceA, o.spaceB].includes(bt) && [o.spaceA, o.spaceB].includes(mb))!;
    door.center = { x: door.center.x, y: door.center.y + 0.05 };
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    variant.floors[1].openings.pop();
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
  });
  it('11: rejects an exterior-wall flag change', () => {
    const { base, variant } = pair();
    const bt = spaceOf(variant, 'master-bathroom');
    bt.hasExteriorWall = !bt.hasExteriorWall;
    expect(adoptStackedPairMinAreaVariant(base, variant)).toBe(base);
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6E OFF identity', () => {
  it('generateLayouts: option omitted and false are byte-identical', () => {
    for (const inp of [input(RECT14, B3LIFT, 42), input(RECT14, B3LIFT, 7), input(RECT, B2, 42)]) {
      expect(snap(gen(inp, { stackedPairMinArea: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...BEST, stackedPairMinArea: false }))).toBe(snap(gen(inp, BEST)));
    }
  });
  it('pipeline DXF: omitted and false identical; R12 header is only $ACADVER = AC1009', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(input(RECT14, B3LIFT, 42)), { allStrategies: true, topCandidates: 4, ...BEST, ...opts });
      return r.candidates.map(c => writeDXF(c, 'QA'));
    };
    const a = dxfs({}), b = dxfs({ stackedPairMinArea: false }), on = dxfs({ stackedPairMinArea: true });
    expect(b).toEqual(a);
    expect(on).not.toEqual(a);
    for (const d of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
    }
  });
});
