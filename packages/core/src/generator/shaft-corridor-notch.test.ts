/**
 * Phase 5.6F — opt-in `notchShaftCorridorOverlap` (shaft / corridor overlap notch).
 *
 * On upper floors of rectangular sites with an elevator, the exact vertical-reuse pin can
 * leave the shaft overlapping one corridor by a sub-tolerance depth (within the existing
 * sameRect tolerance). The corridor is split (5.4D / 5.6B piece pattern) into pieces that
 * tile it minus the overlap strip; the shaft, stair and rooms never move. Adopted only
 * through adoptShaftCorridorNotchVariant. Omitted or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLayouts, adoptShaftCorridorNotchVariant, findShaftCorridorNotch, SHAFT_CORRIDOR_NOTCHED,
  type GenerateLayoutsOptions,
} from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Opening } from '../model/opening.js';
import type { ProjectInput } from '../model/project.js';

const E = 1e-6;
const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const RECT_E = { ...RECT, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 } as const;
const RECT14 = { ...RECT, width: 14, length: 22 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const CUR: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
  stackedPairMinArea: true,
};
const ON: GenerateLayoutsOptions = { ...CUR, notchShaftCorridorOverlap: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const TARGET = ['GEO_OVERLAPPING_ROOMS', 'ELEV_SHAFT_OVERLAP', 'ELEV_SHAFT_NO_LANDING'];
const ADOPTED = 'Phase 5.6F: shaft / corridor overlap notch variant adopted';
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
const clone = (c: LayoutCandidate): LayoutCandidate => JSON.parse(JSON.stringify(c));
const area = (r: Rect) => r.w * r.h;
const ov = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const GEOM = ['type', 'center', 'wallDir', 'normal', 'width', 'height', 'sill', 'swing', 'hinge', 'leafEnd', 'openEnd', 'swingAngle', 'leafThickness', 'floor'] as const;
const sameGeom = (a: Opening, b: Opening, keys: readonly string[] = GEOM) => keys.every(k => JSON.stringify((a as any)[k]) === JSON.stringify((b as any)[k]));

// ---------------------------------------------------------------- pure search
describe('Phase 5.6F findShaftCorridorNotch', () => {
  const shaft: Rect = { x: 4.54, y: 4.9, w: 2.25, h: 1.95 };
  const corridor = { type: 'corridor', rect: { x: 6.78, y: 2, w: 1.51, h: 16.92 } };
  it('diagnosed geometry: notch beside the shaft plus two remainders (derived, not hard-coded)', () => {
    const nt = findShaftCorridorNotch(shaft, [corridor])!;
    expect(nt).not.toBeNull();
    expect(nt.side).toBe('east');
    expect(nt.depth).toBeCloseTo(0.01, 9);
    expect(nt.notch.x).toBeCloseTo(6.79, 9); expect(nt.notch.y).toBeCloseTo(4.9, 9);
    expect(nt.notch.w).toBeCloseTo(1.5, 9); expect(nt.notch.h).toBeCloseTo(1.95, 9);
    expect(nt.remainders).toHaveLength(2);
    const [lo, hi] = nt.remainders;
    expect([lo.x, lo.y, lo.w, lo.h].map(v => +v.toFixed(6))).toEqual([6.78, 2, 1.51, 2.9]);
    expect([hi.x, hi.y, hi.w, hi.h].map(v => +v.toFixed(6))).toEqual([6.78, 6.85, 1.51, 12.07]);
  });
  it('pieces tile the corridor minus the overlap and keep CORRIDOR_MIN_WIDTH', () => {
    const nt = findShaftCorridorNotch(shaft, [corridor])!;
    const pieces = [nt.notch, ...nt.remainders];
    for (const p of pieces) expect(Math.min(p.w, p.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
    for (const p of pieces) expect(ov(p, shaft)).toBeLessThan(E);
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) expect(ov(pieces[i], pieces[j])).toBeLessThan(E);
    expect(pieces.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(corridor.rect) - ov(corridor.rect, shaft), 9);
  });
  it('mirrored side (corridor west of the shaft) is handled symmetrically', () => {
    const nt = findShaftCorridorNotch({ x: 8.28, y: 4.9, w: 2.25, h: 1.95 }, [corridor])!;
    expect(nt.side).toBe('west');
    expect(nt.notch.x + nt.notch.w).toBeCloseTo(8.28, 9);
  });
  it('no-op: overlap deeper than the sameRect tolerance', () => {
    expect(findShaftCorridorNotch({ ...shaft, x: 4.55 }, [corridor])).toBeNull();
  });
  it('no-op: shaft only touches the corridor (no overlap)', () => {
    expect(findShaftCorridorNotch({ ...shaft, x: 4.53 }, [corridor])).toBeNull();
  });
  it('no-op: shaft overlaps two corridors', () => {
    expect(findShaftCorridorNotch(shaft, [corridor, { type: 'corridor', rect: { x: 4, y: 6.8, w: 4, h: 1.5 } }])).toBeNull();
  });
  it('no-op: shaft span not contained by the corridor', () => {
    expect(findShaftCorridorNotch(shaft, [{ type: 'corridor', rect: { x: 6.78, y: 5, w: 1.51, h: 10 } }])).toBeNull();
  });
  it('no-op: a piece would fall below CORRIDOR_MIN_WIDTH', () => {
    expect(findShaftCorridorNotch(shaft, [{ type: 'corridor', rect: { x: 6.78, y: 2, w: CORRIDOR_MIN_WIDTH, h: 16.92 } }])).toBeNull();
  });
  it('deterministic and pure', () => {
    const before = JSON.stringify([shaft, corridor]);
    expect(findShaftCorridorNotch(shaft, [corridor])).toEqual(findShaftCorridorNotch(shaft, [corridor]));
    expect(JSON.stringify([shaft, corridor])).toBe(before);
  });
});

// ---------------------------------------------------------------- generator
describe('Phase 5.6F generator (rectE/b3lift alternative-zoning)', () => {
  for (const seed of [42, 7]) {
    it(`seed ${seed}: the 3 target HARDs clear, valid, only corridor-1-0 split, approved door exception only`, () => {
      const b = byStrategy(gen(input(RECT_E, B3LIFT, seed), CUR), 'alternative-zoning');
      const c = byStrategy(gen(input(RECT_E, B3LIFT, seed), ON), 'alternative-zoning');
      expect(b.valid).toBe(false);
      expect(hard(b).map(f => f.code).sort()).toEqual([...TARGET].sort());
      expect(c.valid).toBe(true);
      expect(hard(c)).toHaveLength(0);
      expect(c.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      expect(c.explanations.some(e => e.includes(SHAFT_CORRIDOR_NOTCHED))).toBe(true);
      // findings: exactly the three target HARDs disappear; nothing else changes
      const cb = counts(b), cc = counts(c);
      for (const t of TARGET) cb.delete(`hard:${t}`);
      expect([...cc].sort()).toEqual([...cb].sort());
      // floors 0 and 2 identical; floor 1 only spaces / walls / openings differ
      expect(c.floors[0]).toEqual(b.floors[0]);
      expect(c.floors[2]).toEqual(b.floors[2]);
      const fb = b.floors[1], fc = c.floors[1];
      for (const k of Object.keys(fb)) if (!['spaces', 'walls', 'openings'].includes(k)) expect((fc as any)[k]).toEqual((fb as any)[k]);
      // every space except the split corridor keeps its rect / type / exterior flag
      const K = fb.spaces.find(s => s.id === 'corridor-1-0')!;
      for (const s of fb.spaces) {
        if (s.id === K.id) continue;
        const v = fc.spaces.find(x => x.id === s.id)!;
        expect(v.rect).toEqual(s.rect); expect(v.type).toBe(s.type); expect(v.hasExteriorWall).toBe(s.hasExteriorWall);
      }
      const shaft = fc.spaces.find(s => s.type === 'elevator-hall')!;
      expect(shaft.rect).toEqual(b.floors[0].spaces.find(s => s.type === 'elevator-hall')!.rect); // vertically aligned
      expect(ov(K.rect, shaft.rect)).toBeGreaterThan(0);
      // pieces tile the corridor minus the overlap strip
      const pieces = fc.spaces.filter(s => s.id === K.id || !fb.spaces.some(x => x.id === s.id));
      expect(pieces).toHaveLength(3);
      for (const p of pieces) {
        expect(p.type).toBe('corridor');
        expect(Math.min(p.rect.w, p.rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - E);
        expect(ov(p.rect, shaft.rect)).toBeLessThan(E);
      }
      expect(pieces.reduce((s, p) => s + area(p.rect), 0)).toBeCloseTo(area(K.rect) - ov(K.rect, shaft.rect), 6);
      const notch = pieces.find(p => p.id === K.id)!;
      expect(notch.rect.x).toBeCloseTo(shaft.rect.x + shaft.rect.w, 9);
      // openings: windows identical; existing doors identical except piece references;
      // the stair-hall-1-000 door may only mirror its swing; new = 2 piece doors + 1 landing
      const used = new Set<number>();
      let stairFlips = 0;
      for (const o of fb.openings) {
        const j = fc.openings.findIndex((m, i) => !used.has(i) && sameGeom(m, o));
        if (j >= 0) { used.add(j); continue; }
        expect(o.type).toBe('door');
        expect([o.spaceA, o.spaceB]).toContain('stair-hall-1-000');
        const fixed = ['type', 'center', 'wallDir', 'normal', 'width', 'height', 'sill', 'swingAngle', 'leafThickness', 'floor'];
        const k = fc.openings.findIndex((m, i) => !used.has(i) && sameGeom(m, o, fixed));
        expect(k).toBeGreaterThanOrEqual(0);
        const m = fc.openings[k];
        expect(m.swing).not.toBe(o.swing);
        expect(m.hinge!.x).toBeCloseTo(2 * o.center.x - o.hinge!.x, 9);
        expect(m.hinge!.y).toBeCloseTo(2 * o.center.y - o.hinge!.y, 9);
        expect([m.spaceA, m.spaceB]).toContain('stair-hall-1-000');
        used.add(k); stairFlips++;
      }
      expect(stairFlips).toBe(1);
      const added = fc.openings.filter((_, i) => !used.has(i));
      expect(added).toHaveLength(3);
      const pieceIds = new Set(pieces.map(p => p.id));
      expect(added.every(o => o.type === 'door')).toBe(true);
      expect(added.filter(o => pieceIds.has(o.spaceA!) && pieceIds.has(o.spaceB!))).toHaveLength(2);
      expect(added.filter(o => [o.spaceA, o.spaceB].includes(shaft.id))).toHaveLength(1);
      const wins = (f: typeof fb) => f.openings.filter(o => o.type === 'window').map(o => JSON.stringify(GEOM.map(k => (o as any)[k])) + o.spaceA + o.spaceB).sort();
      expect(wins(fc)).toEqual(wins(fb)); // window ids renumber; geometry and spaces identical
    });
  }
  it('other candidates unchanged (guard never adopts elsewhere)', () => {
    const b = gen(input(RECT_E, B3LIFT, 42), CUR), c = gen(input(RECT_E, B3LIFT, 42), ON);
    for (const s of ['area-efficiency', 'functional-circulation', 'daylight-orientation']) expect(snapOne(byStrategy(c, s))).toBe(snapOne(byStrategy(b, s)));
    for (const [site, prog] of [[RECT, B3LIFT], [RECT14, B3LIFT], [RECT_E, B4], [LSHAPE, B3LIFT]] as Array<[object, object]>) {
      const inp = input(site, prog, 42);
      expect(snap(gen(inp, ON))).toBe(snap(gen(inp, CUR)));
    }
  });
  it('deterministic repeated generation', () => {
    const inp = input(RECT_E, B3LIFT, 42);
    expect(snap(gen(inp, ON))).toBe(snap(gen(inp, ON)));
  });
});

// ---------------------------------------------------------------- guard
describe('Phase 5.6F adoptShaftCorridorNotchVariant guard', () => {
  const pair = () => {
    const base = byStrategy(gen(input(RECT_E, B3LIFT, 42), CUR), 'alternative-zoning');
    const variant = clone(byStrategy(gen(input(RECT_E, B3LIFT, 42), ON), 'alternative-zoning'));
    variant.explanations = variant.explanations.filter(e => !e.startsWith('Phase 5.6F:'));
    return { base, variant };
  };
  const sp = (c: LayoutCandidate, pred: (s: any) => boolean) => c.floors[1].spaces.find(pred)!;
  it('adopts the real variant', () => {
    const { base, variant } = pair();
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(variant);
  });
  it('1: rejects without the marker', () => {
    const { base, variant } = pair();
    variant.explanations = variant.explanations.filter(e => !e.includes(SHAFT_CORRIDOR_NOTCHED));
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('3/4: rejects when the overlap HARDs do not decrease', () => {
    const { base } = pair();
    const v = clone(base);
    v.explanations.push(`${SHAFT_CORRIDOR_NOTCHED}: test`);
    expect(adoptShaftCorridorNotchVariant(base, v)).toBe(base);
  });
  it('6/7: rejects a new HARD code or a new circulation finding', () => {
    let { base, variant } = pair();
    const tpl = hard(base, 'ELEV_SHAFT_OVERLAP')[0];
    variant.findings.push({ ...tpl, code: 'TEST_NEW_HARD' });
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    variant.findings.push({ ...tpl, severity: 'soft', code: 'CIRC_TEST' });
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('8/9: rejects a moved room, stair or shaft, or a piece below CORRIDOR_MIN_WIDTH', () => {
    for (const t of ['bedroom', 'stair-hall', 'elevator-hall']) {
      const { base, variant } = pair();
      const s = sp(variant, x => x.type === t);
      s.rect = { ...s.rect, x: s.rect.x + 0.01 };
      expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
    }
    const { base, variant } = pair();
    const p = sp(variant, x => x.id === 'corridor-1-0');
    p.rect = { ...p.rect, w: CORRIDOR_MIN_WIDTH - 0.05 };
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('9: rejects a second floor changing', () => {
    const { base, variant } = pair();
    const s = variant.floors[2].spaces.find(x => x.type === 'bedroom')!;
    s.rect = { ...s.rect, h: s.rect.h - 0.01 };
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('10: rejects any other changed door / window', () => {
    let { base, variant } = pair();
    const w = variant.floors[1].openings.find(o => o.type === 'window')!;
    w.width += 0.01;
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    const d = variant.floors[1].openings.find(o => o.type === 'door' && [o.spaceA, o.spaceB].includes('bedroom-1-005'))!;
    d.center = { x: d.center.x, y: d.center.y + 0.05 };
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('10: stair-hall door exception — only swing mirror allowed; center / width must stay fixed', () => {
    let { base, variant } = pair();
    const d = () => variant.floors[1].openings.find(o => o.type === 'door' && [o.spaceA, o.spaceB].includes('stair-hall-1-000'))!;
    d().center = { x: d().center.x, y: d().center.y + 0.05 };
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    d().width += 0.1;
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
    ({ base, variant } = pair());
    d().hinge = { x: d().hinge!.x, y: d().hinge!.y + 0.1 };
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('11: rejects an extra new opening beyond the landing / piece doors', () => {
    const { base, variant } = pair();
    const extra = { ...variant.floors[1].openings.find(o => o.type === 'door' && [o.spaceA, o.spaceB].includes('bedroom-1-005'))!, id: 'door-extra', center: { x: 6.78, y: 15 } };
    variant.floors[1].openings.push(extra);
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
  it('12: rejects an exterior-wall flag change', () => {
    const { base, variant } = pair();
    const s = sp(variant, x => x.type === 'bedroom');
    s.hasExteriorWall = !s.hasExteriorWall;
    expect(adoptShaftCorridorNotchVariant(base, variant)).toBe(base);
  });
});

// ---------------------------------------------------------------- OFF identity + DXF
describe('Phase 5.6F OFF identity and DXF', () => {
  it('option omitted / false byte-identical; no-options baseline unchanged', () => {
    for (const inp of [input(RECT_E, B3LIFT, 42), input(RECT_E, B3LIFT, 7), input(RECT, B2, 42)]) {
      expect(snap(gen(inp, { notchShaftCorridorOverlap: false }))).toBe(snap(gen(inp)));
      expect(snap(gen(inp, { ...CUR, notchShaftCorridorOverlap: false }))).toBe(snap(gen(inp, CUR)));
    }
  });
  it('pipeline DXF: omitted and false identical; ON differs only in the adopted candidate; R12 profile intact', () => {
    const dxfs = (opts: object) => {
      const r = generate(createProject(input(RECT_E, B3LIFT, 42)), { allStrategies: true, topCandidates: 4, ...CUR, ...opts });
      return r.candidates.map(c => ({ s: c.metadata.strategy, d: writeDXF(c, 'QA') }));
    };
    const a = dxfs({}), b = dxfs({ notchShaftCorridorOverlap: false }), on = dxfs({ notchShaftCorridorOverlap: true });
    expect(b).toEqual(a);
    for (const x of on) {
      const y = a.find(z => z.s === x.s);
      if (x.s === 'alternative-zoning') expect(x.d).not.toBe(y?.d);
      else if (y) expect(x.d).toBe(y.d);
    }
    for (const { d } of [...a, ...on]) {
      const hdr = d.slice(0, d.indexOf('ENDSEC'));
      expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
      expect(hdr).toMatch(/\$ACADVER\r?\n\s*1\r?\nAC1009/);
      expect(/^[\x00-\x7f]*$/.test(d)).toBe(true);
      expect(/NaN|Infinity/.test(d)).toBe(false);
      expect(d.trimEnd().endsWith('EOF')).toBe(true);
    }
  });
});
