/**
 * Task 135 — opt-in `stairConnectorHardReduction`.
 *
 * A second, separate adoption path for the Phase 5.4B stair-core connector variant that is
 * already built when `connectStairCore` is on. It is consulted only when the unchanged 5.4B
 * guard rejected the variant, and adopts it only through
 * adoptStairConnectorHardReductionVariant (total HARD strictly decreases; no HARD code and no
 * circulation / access / daylight finding of any severity increases; validity kept; existing
 * spaces and exterior walls unchanged; only in-footprint, non-overlapping corridor connectors
 * added). Omitted or false must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  generateLayouts, adoptStairConnectorHardReductionVariant, STAIR_CONNECTOR_HARD_REDUCTION_ADOPTED,
  type GenerateLayoutsOptions,
} from './generator.js';
import { writeDXF } from '../dxf/writer.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';

const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const B2 = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;
const B1 = { ...B2, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };
const B3LIFT = { ...B2, bedrooms: 3, hasElevator: true, floors: 3 };
const B4 = { ...B2, bedrooms: 3, bathrooms: 2, hasStorage: true };
const SITES: Record<string, object> = {
  rect: RECT,
  rectE: { ...RECT, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 },
  rect14: { ...RECT, width: 14, length: 22 },
  lshape: { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } },
};
const PROGS: Record<string, object> = { b1: B1, b2: B2, b3lift: B3LIFT, b4: B4 };
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const CURRENT: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
  stackedPairMinArea: true, notchShaftCorridorOverlap: true, lShapeUpperCoreCirculation: true, lShapeRoomQualitySelection: true,
};
const ON: GenerateLayoutsOptions = { ...CURRENT, stairConnectorHardReduction: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;

const snapOne = (c: LayoutCandidate) => JSON.stringify({ ...c, metadata: { ...c.metadata, generatedAt: 0 } });
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));
const counts = (c: LayoutCandidate) => {
  const m = new Map<string, number>();
  for (const f of c.findings) m.set(`${f.severity}:${f.code}`, (m.get(`${f.severity}:${f.code}`) ?? 0) + 1);
  return m;
};
const clone = (c: LayoutCandidate): LayoutCandidate => JSON.parse(JSON.stringify(c));

type Row = { id: string; c: LayoutCandidate; snap: string };
const bench = (opts?: GenerateLayoutsOptions): Row[] => {
  const rows: Row[] = [];
  for (const [sk, site] of Object.entries(SITES)) for (const [pk, b] of Object.entries(PROGS)) for (const seed of [42, 7]) {
    const inp = input(site, b, seed);
    const cs = opts === undefined ? generateLayouts(inp, [...STRATS]) : generateLayouts(inp, [...STRATS], opts);
    for (const c of cs) rows.push({ id: `${sk}/${pk}/${seed}/${c.metadata.strategy}`, c, snap: snapOne(c) });
  }
  return rows;
};
const totals = (rows: Row[]) => ({ valid: rows.filter(r => r.c.valid).length, hard: rows.reduce((s, r) => s + hard(r.c).length, 0) });
const hardCode = (rows: Row[], code: string) => rows.reduce((s, r) => s + hard(r.c, code).length, 0);

const TARGETS = ['rectE/b4/42/daylight-orientation', 'rectE/b4/7/daylight-orientation'];

// ------------------------------------------------------------- 128-case benchmark
describe('Task 135 — 128-case benchmark (CURRENT options)', () => {
  const base = bench(CURRENT);
  const off = bench({ ...CURRENT, stairConnectorHardReduction: false });
  const on = bench(ON);
  const on2 = bench(ON);

  it('baseline reproduces 110 valid / 74 HARD', () => {
    expect(base).toHaveLength(128);
    expect(totals(base)).toEqual({ valid: 110, hard: 74 });
  });

  it('stairConnectorHardReduction: false is byte-identical to the option omitted', () => {
    expect(off.map(r => r.snap)).toEqual(base.map(r => r.snap));
  });

  it('true: 110 valid / 70 HARD; CIRC_ROOM_THROUGH_ROOM 6→4; CONSTRAINT_MUST_ADJACENT 4→2', () => {
    expect(totals(on)).toEqual({ valid: 110, hard: 70 });
    expect([hardCode(base, 'CIRC_ROOM_THROUGH_ROOM'), hardCode(on, 'CIRC_ROOM_THROUGH_ROOM')]).toEqual([6, 4]);
    expect([hardCode(base, 'CONSTRAINT_MUST_ADJACENT'), hardCode(on, 'CONSTRAINT_MUST_ADJACENT')]).toEqual([4, 2]);
  });

  it('true is deterministic (repeated runs byte-identical)', () => {
    expect(on2.map(r => r.snap)).toEqual(on.map(r => r.snap));
  });

  it('exactly the two intended candidates change', () => {
    const changed = on.filter((r, i) => r.snap !== base[i].snap).map(r => r.id);
    expect(changed).toEqual(TARGETS);
    for (const id of TARGETS) {
      const c = on.find(r => r.id === id)!.c;
      expect(c.explanations.some(e => e.startsWith(STAIR_CONNECTOR_HARD_REDUCTION_ADOPTED))).toBe(true);
    }
  });

  it('no finding of any severity increases in any candidate; changed ones only lose the two HARD codes', () => {
    for (let i = 0; i < base.length; i++) {
      const cb = counts(base[i].c), cc = counts(on[i].c);
      for (const [k, n] of cc) expect(n, `${on[i].id} ${k}`).toBeLessThanOrEqual(cb.get(k) ?? 0);
    }
    for (const id of TARGETS) {
      const cb = counts(base.find(r => r.id === id)!.c), cc = counts(on.find(r => r.id === id)!.c);
      expect(cc.get('hard:CIRC_ROOM_THROUGH_ROOM')).toBe(2);
      expect(cc.has('hard:CONSTRAINT_MUST_ADJACENT')).toBe(false);
      cb.set('hard:CIRC_ROOM_THROUGH_ROOM', 2); cb.delete('hard:CONSTRAINT_MUST_ADJACENT');
      expect([...cc].sort()).toEqual([...cb].sort());
    }
  });

  it('changed candidates: every existing space unchanged; one in-footprint corridor connector ≤ 60 m² added on L1; DXF stays R12', () => {
    for (const id of TARGETS) {
      const b = base.find(r => r.id === id)!.c, c = on.find(r => r.id === id)!.c;
      expect(c.valid).toBe(b.valid);
      expect(c.floors.map(f => f.level)).toEqual(b.floors.map(f => f.level));
      for (const fb of b.floors) {
        const fc = c.floors.find(f => f.level === fb.level)!;
        expect(fc.footprint).toEqual(fb.footprint);
        for (const s of fb.spaces) {
          const v = fc.spaces.find(x => x.id === s.id)!;
          expect(v.type).toBe(s.type);
          expect(v.rect).toEqual(s.rect);
          expect(v.polygon).toEqual(s.polygon);
        }
        const added = fc.spaces.filter(s => !fb.spaces.some(x => x.id === s.id));
        if (fb.level !== 1) { expect(added).toHaveLength(0); continue; }
        expect(added).toHaveLength(1);
        const a = added[0];
        expect(a.type).toBe('corridor');
        expect(a.rect.w * a.rect.h).toBeLessThanOrEqual(60);
        expect(a.rect.x).toBeGreaterThanOrEqual(fc.footprint.x - 1e-6);
        expect(a.rect.y).toBeGreaterThanOrEqual(fc.footprint.y - 1e-6);
        expect(a.rect.x + a.rect.w).toBeLessThanOrEqual(fc.footprint.x + fc.footprint.w + 1e-6);
        expect(a.rect.y + a.rect.h).toBeLessThanOrEqual(fc.footprint.y + fc.footprint.h + 1e-6);
        for (const o of fc.spaces) {
          if (o.id === a.id) continue;
          const ox = Math.min(a.rect.x + a.rect.w, o.rect.x + o.rect.w) - Math.max(a.rect.x, o.rect.x);
          const oy = Math.min(a.rect.y + a.rect.h, o.rect.y + o.rect.h) - Math.max(a.rect.y, o.rect.y);
          expect(ox > 1e-3 && oy > 1e-3, `${a.id} overlaps ${o.id}`).toBe(false);
        }
      }
      const dxf = writeDXF(c, 'Task 135');
      const header = dxf.slice(0, dxf.indexOf('ENDSEC'));
      expect(header).toMatch(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC1009/);
      expect((header.match(/\r?\n\s*9\s*\r?\n\$/g) ?? []).length).toBe(1);
    }
  });
}, 600_000);

// ------------------------------------------------------------- pure guard
describe('Task 135 — adoptStairConnectorHardReductionVariant (pure guard)', () => {
  const inp = input(SITES.rectE, B4, 42);
  const b = generateLayouts(JSON.parse(JSON.stringify(inp)), ['daylight-orientation'], CURRENT)[0];
  const v = generateLayouts(JSON.parse(JSON.stringify(inp)), ['daylight-orientation'], ON)[0];
  const variant = () => { const x = clone(v); x.explanations = x.explanations.filter(e => !e.startsWith(STAIR_CONNECTOR_HARD_REDUCTION_ADOPTED)); return x; };

  it('adopts the connector variant when every condition holds', () => {
    const x = variant();
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(x);
  });
  it('rejects an identical variant', () => {
    expect(adoptStairConnectorHardReductionVariant(b, clone(b))).toBe(b);
  });
  it('rejects when total HARD does not strictly decrease', () => {
    const x = variant();
    x.findings.push(...hard(b).slice(0, hard(b).length - hard(x).length));
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });
  it('rejects when a circulation / access / daylight finding of any severity increases', () => {
    const x = variant();
    x.findings.push({ code: 'ROOM_DAYLIGHT_QUALITY', severity: 'soft', message: 'test', entityIds: [] } as LayoutCandidate['findings'][number]);
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });
  it('rejects when an existing space moved or resized', () => {
    const x = variant();
    const s = x.floors[1].spaces.find(sp => sp.type === 'stair-hall')!;
    s.rect = { ...s.rect, x: s.rect.x + 0.1 };
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });
  it('rejects when an existing space is missing (programme change)', () => {
    const x = variant();
    x.floors[1].spaces = x.floors[1].spaces.filter(sp => sp.type !== 'bathroom');
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });
  it('rejects a non-corridor addition, an overlapping or out-of-footprint connector', () => {
    const add = (mut: (r: LayoutCandidate['floors'][number]['spaces'][number]) => void) => {
      const x = variant();
      const a = x.floors[1].spaces.find(sp => !b.floors[1].spaces.some(o => o.id === sp.id))!;
      mut(a);
      return adoptStairConnectorHardReductionVariant(b, x);
    };
    expect(add(a => { a.type = 'storage' as typeof a.type; })).toBe(b);
    expect(add(a => { a.rect = { ...a.rect, y: a.rect.y - 1 }; })).toBe(b);
    expect(add(a => { a.rect = { ...a.rect, x: 100 }; })).toBe(b);
  });
  // --- exterior-wall exception: exactly the connector-edge-coincident intervals ---------------
  type W = LayoutCandidate['floors'][number]['walls'][number];
  const connectorOf = (c: LayoutCandidate) => c.floors[1].spaces.find(sp => !b.floors[1].spaces.some(o => o.id === sp.id))!.rect;
  const T = 1e-3;
  const onLine = (w: W, o: 'h' | 'v', c: number) => (o === 'h'
    ? Math.abs(w.start.y - c) < T && Math.abs(w.end.y - c) < T
    : Math.abs(w.start.x - c) < T && Math.abs(w.end.x - c) < T);
  const span = (w: W, o: 'h' | 'v') => (o === 'h' ? [Math.min(w.start.x, w.end.x), Math.max(w.start.x, w.end.x)] : [Math.min(w.start.y, w.end.y), Math.max(w.start.y, w.end.y)]);

  it('allows exterior-wall changes exactly on the connector edge (target geometry)', () => {
    const x = variant();
    const r = connectorOf(x);
    // the variant has an exterior wall lying exactly on the connector's east edge, and the base
    // has exterior walls on the connector's west / top / bottom edge lines — all differ, yet adoption holds
    const ext = (c: LayoutCandidate) => c.floors[1].walls.filter(w => w.kind === 'exterior');
    const eastV = ext(x).find(w => onLine(w, 'v', r.x + r.w))!;
    expect(eastV).toBeDefined();
    expect(span(eastV, 'v')[0]).toBeCloseTo(r.y, 3);
    expect(span(eastV, 'v')[1]).toBeCloseTo(r.y + r.h, 3);
    expect(ext(b).some(w => onLine(w, 'v', r.x + r.w))).toBe(false);
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(x);
  });

  it('detects a change to an exterior-wall continuation beyond the connector edge span', () => {
    // variant wall on the connector's bottom edge line that continues past the connector (x > r.x + r.w)
    const x = variant();
    const r = connectorOf(x);
    const cont = x.floors[1].walls.find(w => w.kind === 'exterior' && onLine(w, 'h', r.y) && span(w, 'h')[1] > r.x + r.w + T)!;
    expect(cont).toBeDefined();
    // shorten only the part OUTSIDE the connector edge span
    if (cont.end.x >= cont.start.x) cont.end = { ...cont.end, x: cont.end.x - 0.1 }; else cont.start = { ...cont.start, x: cont.start.x - 0.1 };
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });

  it('detects a connector-edge wall that is extended beyond the connector edge span', () => {
    const x = variant();
    const r = connectorOf(x);
    const east = x.floors[1].walls.find(w => w.kind === 'exterior' && onLine(w, 'v', r.x + r.w))!;
    // extend past the connector's top edge: only [r.y, r.y + r.h] may be exempt
    if (east.end.y >= east.start.y) east.end = { ...east.end, y: east.end.y + 0.3 }; else east.start = { ...east.start, y: east.start.y + 0.3 };
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
  });

  it('rejects when an exterior wall away from the connector changes', () => {
    const x = variant();
    const r = connectorOf(x);
    const far = x.floors[1].walls.find(w => w.kind === 'exterior' && Math.max(w.start.x, w.end.x) < r.x - 1)!;
    expect(far).toBeDefined();
    far.thickness += 0.1;
    expect(adoptStairConnectorHardReductionVariant(b, x)).toBe(b);
    const y = variant();
    const far2 = y.floors[1].walls.find(w => w.kind === 'exterior' && Math.max(w.start.x, w.end.x) < r.x - 1)!;
    far2.start = { ...far2.start, x: far2.start.x + 0.05 };
    expect(adoptStairConnectorHardReductionVariant(b, y)).toBe(b);
  });

  it('rejects when a valid base would become invalid', () => {
    const vb = clone(b); vb.valid = true;
    expect(adoptStairConnectorHardReductionVariant(vb, variant())).toBe(vb);
  });
});
