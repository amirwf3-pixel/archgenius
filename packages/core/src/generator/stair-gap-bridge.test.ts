/**
 * Phase 5.4D — opt-in `bridgeThinStairGap` (post-placement upper-floor repair).
 *
 * When re-pinning an upper-floor stair hall onto the core anchor leaves an empty gap
 * thinner than CORRIDOR_MIN_WIDTH between the hall and a facing corridor, the corridor
 * run over the hall overlap is replaced by a bridge corridor (gap + full corridor
 * depth); the rest of the corridor is kept as remainder pieces. Hall, stair, anchor
 * and rooms never move. Adoption is validator-guarded; OFF is identical.
 */
import { describe, it, expect } from 'vitest';
import { findThinStairGapBridge, adoptThinStairGapBridgeVariant, generateLayouts } from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Rect } from '../geometry/rect.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

// ---------------------------------------------------------------- pure finder
describe('Phase 5.4D findThinStairGapBridge (pure)', () => {
  const inside = () => true;
  const hall: Rect = { x: 11.7, y: 12.65, w: 2.6, h: 4.2 };
  const corridor: Rect = { x: 4.69, y: 10.25, w: 9.61, h: 1.5 };
  const bedroom: Rect = { x: 8.78, y: 11.75, w: 2.92, h: 8.25 };
  const sp = (c: Rect, extra: { type: string; rect: Rect }[] = [], h: Rect = hall) =>
    [{ type: 'corridor', rect: c }, { type: 'master-bedroom', rect: bedroom }, { type: 'stair-hall', rect: h }, ...extra];
  const close = (a: Rect, b: Rect) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 9); };

  it('thin gap: bridge = gap + full corridor depth over the hall overlap; remainder kept', () => {
    const r = findThinStairGapBridge(hall, sp(corridor), inside)!;
    expect(r).not.toBeNull();
    expect(r.side).toBe('south');
    expect(r.gap).toBeCloseTo(0.9, 9);
    close(r.bridge, { x: 11.7, y: 10.25, w: 2.6, h: 2.4 });
    expect(r.remainders).toHaveLength(1);
    close(r.remainders[0], { x: 4.69, y: 10.25, w: 7.01, h: 1.5 });
    for (const p of [r.bridge, ...r.remainders]) expect(Math.min(p.w, p.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - 1e-9);
    // Bridge meets the hall edge and keeps the corridor's far edge.
    expect(r.bridge.y + r.bridge.h).toBeCloseTo(hall.y, 9);
    expect(r.bridge.y).toBeCloseTo(corridor.y, 9);
  });

  it('vertical corridor (west of hall), the rect14 pattern', () => {
    const h: Rect = { x: 7.75, y: 5.7, w: 4.2, h: 2.66 };
    const k: Rect = { x: 5.65, y: 5.7, w: 1.5, h: 13.3 };
    const r = findThinStairGapBridge(h, [{ type: 'corridor', rect: k }, { type: 'stair-hall', rect: h }], inside)!;
    expect(r.side).toBe('west');
    close(r.bridge, { x: 5.65, y: 5.7, w: 2.1, h: 2.66 });
    expect(r.remainders).toHaveLength(1);
    close(r.remainders[0], { x: 5.65, y: 8.36, w: 1.5, h: 10.64 });
  });

  it('zero-length remainders are dropped', () => {
    const k: Rect = { x: 11.7, y: 10.25, w: 2.6, h: 1.5 };
    const r = findThinStairGapBridge(hall, sp(k), inside)!;
    expect(r.remainders).toEqual([]);
    close(r.bridge, { x: 11.7, y: 10.25, w: 2.6, h: 2.4 });
  });

  it('excluded: gap ≥ CORRIDOR_MIN_WIDTH (5.4B territory)', () => {
    const h = { ...hall, y: corridor.y + corridor.h + CORRIDOR_MIN_WIDTH };
    expect(findThinStairGapBridge(h, sp(corridor, [], h), inside)).toBeNull();
  });
  it('excluded: hall already connected', () => {
    const h = { ...hall, y: corridor.y + corridor.h };
    expect(findThinStairGapBridge(h, sp(corridor, [], h), inside)).toBeNull();
  });
  it('excluded: touching with a short contact is not a gap', () => {
    const k: Rect = { x: 4.69, y: 10.25, w: 7.81, h: 1.5 }; // ends 0.8 m into the hall span
    const h = { ...hall, y: k.y + k.h };
    expect(findThinStairGapBridge(h, sp(k, [], h), inside)).toBeNull();
  });
  it('excluded: blocked gap', () => {
    const blocker = { type: 'bathroom', rect: { x: 12.5, y: 11.75, w: 1.0, h: 0.9 } };
    expect(findThinStairGapBridge(hall, sp(corridor, [blocker]), inside)).toBeNull();
  });
  it('excluded: hall overlap shorter than CORRIDOR_MIN_WIDTH', () => {
    const k: Rect = { x: 4.69, y: 10.25, w: 7.81, h: 1.5 }; // overlap 0.8 m
    expect(findThinStairGapBridge(hall, sp(k), inside)).toBeNull();
  });
  it('excluded: outside buildable geometry', () => {
    expect(findThinStairGapBridge(hall, sp(corridor), () => false)).toBeNull();
  });
  it('excluded: a remainder would be a sub-minimum sliver', () => {
    const k: Rect = { x: 11.0, y: 10.25, w: 3.3, h: 1.5 }; // 0.7 m remainder west of the span
    expect(findThinStairGapBridge(hall, sp(k), inside)).toBeNull();
  });
  it('excluded: no facing corridor', () => {
    const k: Rect = { x: 2, y: 2, w: 1.5, h: 5 };
    expect(findThinStairGapBridge(hall, [{ type: 'corridor', rect: k }, { type: 'stair-hall', rect: hall }], inside)).toBeNull();
  });
  it('deterministic: smallest gap wins', () => {
    const far: Rect = { x: 14.3 + 1.0, y: 12.65, w: 1.5, h: 4.2 }; // east, gap 1.0
    const r = findThinStairGapBridge(hall, sp(corridor, [{ type: 'corridor', rect: far }]), inside)!;
    expect(r.gap).toBeCloseTo(0.9, 9);
    expect(findThinStairGapBridge(hall, sp(corridor, [{ type: 'corridor', rect: far }]), inside)).toEqual(r);
  });
});

// ---------------------------------------------------------------- generator
const B = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const B4 = { ...B, bedrooms: 3, bathrooms: 2, hasStorage: true };
const R = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const mk = (site: object, building: object, seed: number) => ({ site, building, seed, deterministic: true, jurisdiction: 'IR' });
const FIX = {
  rect14: mk({ ...R, width: 14, length: 22 }, B4, 42),
  rectE: mk({ ...R, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 }, B, 42),
  genericEast: mk({ shape: 'rectangle', width: 18.9, length: 23.5, streetWidth: 9, accessSide: 'east', setbackNorth: 2.5, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 }, B, 11),
  genericSouth: mk({ shape: 'rectangle', width: 13.9, length: 20.5, streetWidth: 9, accessSide: 'south', setbackNorth: 2.2, setbackSouth: 1.8, setbackEast: 1.6, setbackWest: 1.4 }, B, 17),
};
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
const n = (c: LayoutCandidate, code: string) => c.findings.filter(f => f.code === code).length;
const reach = (c: LayoutCandidate) => n(c, 'CIRC_INACCESSIBLE_SPACE') + n(c, 'CIRC_ROOM_THROUGH_ROOM');
function shared(a: Rect, b: Rect, t = 1e-3): number {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((Math.abs(a.x + a.w - b.x) < t || Math.abs(b.x + b.w - a.x) < t) && oy > t) return oy;
  if ((Math.abs(a.y + a.h - b.y) < t || Math.abs(b.y + b.h - a.y) < t) && ox > t) return ox;
  return 0;
}
const overlaps = (rs: Rect[]) => rs.flatMap((a, i) => rs.slice(i + 1).filter(b =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6));
const ADOPTED = 'Phase 5.4D: thin-gap stair-bridge variant adopted';

describe('Phase 5.4D bridgeThinStairGap — generator', () => {
  for (const [name, inp] of Object.entries(FIX)) {
    it(`${name}: bridge adopted, hall joined, pieces ≥ minimum, no overlap, rooms/hall/stair unchanged`, () => {
      const off = cand(inp, 'daylight-orientation', {});
      const on = cand(inp, 'daylight-orientation', { bridgeThinStairGap: true });
      expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
      expect(n(on, 'CONSTRAINT_MUST_ADJACENT')).toBeLessThan(n(off, 'CONSTRAINT_MUST_ADJACENT'));
      expect(reach(on)).toBeLessThan(reach(off));
      noAdded(off, on);
      expect(on.valid || !off.valid).toBe(true);
      // Ground floor untouched.
      expect(JSON.stringify(on.floors[0])).toBe(JSON.stringify(off.floors[0]));
      let bridged = 0;
      on.floors.forEach((fl, li) => {
        const offFl = off.floors[li];
        // Every non-corridor space (rooms, halls) and the stair are unchanged.
        const nonCorr = (f: typeof fl) => f.spaces.filter(s => s.type !== 'corridor').map(s => [s.id, s.rect]);
        expect(nonCorr(fl)).toEqual(nonCorr(offFl));
        expect(JSON.stringify(fl.stairs)).toBe(JSON.stringify(offFl.stairs));
        const cors = fl.spaces.filter(s => s.type === 'corridor');
        for (const c of cors) expect(Math.min(c.rect.w, c.rect.h)).toBeGreaterThanOrEqual(CORRIDOR_MIN_WIDTH - 1e-6);
        expect(overlaps(fl.spaces.map(s => s.rect))).toEqual([]);
        if (li === 0) return;
        const hall = fl.spaces.find(s => s.type === 'stair-hall')!;
        const offHall = offFl.spaces.find(s => s.type === 'stair-hall')!;
        const wasJoined = offFl.spaces.some(s => s.type === 'corridor' && shared(offHall.rect, s.rect) >= CORRIDOR_MIN_WIDTH - 1e-6);
        const isJoined = cors.some(s => shared(hall.rect, s.rect) >= CORRIDOR_MIN_WIDTH - 1e-6);
        if (!wasJoined && isJoined) {
          bridged++;
          // Corridor area only grows (gap added, nothing removed).
          const area = (f: typeof fl) => f.spaces.filter(s => s.type === 'corridor').reduce((a, s) => a + s.rect.w * s.rect.h, 0);
          expect(area(fl)).toBeGreaterThan(area(offFl));
        }
      });
      expect(bridged).toBeGreaterThan(0);
    });
  }

  it('rect14 benchmark fixture becomes valid', () => {
    expect(cand(FIX.rect14, 'daylight-orientation', {}).valid).toBe(false);
    expect(cand(FIX.rect14, 'daylight-orientation', { bridgeThinStairGap: true }).valid).toBe(true);
  });

  it('excluded conditions leave the candidate unchanged', () => {
    const cases: [object, string][] = [
      // clean gap ≥ minimum (5.4B territory) — rectE b4 daylight
      [mk({ ...R, width: 20, length: 22, streetWidth: 10, accessSide: 'east', setbackNorth: 2, setbackSouth: 2 }, B4, 42), 'daylight-orientation'],
      // L-shape, hall in the notch arm, no facing corridor
      [mk({ ...R, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } }, B4, 42), 'alternative-zoning'],
      // hall already connected
      [FIX.rect14, 'functional-circulation'],
      // single floor (ground floor only)
      [mk({ ...R }, { ...B, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 }, 42), 'daylight-orientation'],
    ];
    for (const [inp, st] of cases) {
      const off = cand(inp, st, {});
      const on = cand(inp, st, { bridgeThinStairGap: true });
      expect(JSON.stringify(on.floors)).toBe(JSON.stringify(off.floors));
      expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(false);
    }
  });

  it('adoptThinStairGapBridgeVariant guard: accept / reject', () => {
    const f = (code: string, severity: Finding['severity'] = 'hard') => ({ code, severity, message: '' }) as Finding;
    const c = (valid: boolean, findings: Finding[], tag: string) =>
      ({ valid, findings, floors: [{ tag }], explanations: [] }) as unknown as LayoutCandidate;
    const base = c(false, [f('CONSTRAINT_MUST_ADJACENT'), f('CIRC_ROOM_THROUGH_ROOM')], 'a');
    // accept: both strictly decrease, nothing added (through-room counts toward reach)
    expect(adoptThinStairGapBridgeVariant(base, c(true, [], 'b')).floors).toEqual([{ tag: 'b' }]);
    // reject: MUST_ADJACENT not decreased
    expect(adoptThinStairGapBridgeVariant(base, c(false, [f('CONSTRAINT_MUST_ADJACENT')], 'b'))).toBe(base);
    // reject: reach not decreased
    expect(adoptThinStairGapBridgeVariant(base, c(false, [f('CIRC_ROOM_THROUGH_ROOM')], 'b'))).toBe(base);
    // reject: a new HARD code
    expect(adoptThinStairGapBridgeVariant(base, c(false, [f('GEO_OVERLAPPING_ROOMS')], 'b'))).toBe(base);
    // reject: a new circulation soft finding
    expect(adoptThinStairGapBridgeVariant(base, c(false, [f('CIRCULATION_DEAD_END', 'soft')], 'b'))).toBe(base);
    // reject: validity lost
    const vb = c(true, [f('CONSTRAINT_MUST_ADJACENT', 'soft'), f('CIRC_ROOM_THROUGH_ROOM', 'soft')], 'a');
    expect(adoptThinStairGapBridgeVariant(vb, c(false, [], 'b'))).toBe(vb);
    // identical floors → base
    expect(adoptThinStairGapBridgeVariant(base, c(true, [], 'a'))).toBe(base);
    // inaccessible counts toward reach too
    const b2 = c(false, [f('CONSTRAINT_MUST_ADJACENT'), f('CIRC_INACCESSIBLE_SPACE'), f('CIRC_INACCESSIBLE_SPACE')], 'a');
    expect(adoptThinStairGapBridgeVariant(b2, c(false, [f('CIRC_INACCESSIBLE_SPACE')], 'b')).floors).toEqual([{ tag: 'b' }]);
  });

  it('deterministic', () => {
    const a = cand(FIX.rectE, 'daylight-orientation', { bridgeThinStairGap: true });
    const b = cand(FIX.rectE, 'daylight-orientation', { bridgeThinStairGap: true });
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it('option false is identical to omitted (generator + pipeline DXF)', () => {
    for (const inp of [FIX.rect14, FIX.rectE]) {
      expect(JSON.stringify(cand(inp, 'daylight-orientation', { bridgeThinStairGap: false }).floors))
        .toBe(JSON.stringify(cand(inp, 'daylight-orientation', {}).floors));
      const omit = generate(createProject(clone(inp) as never)).candidates;
      const off = generate(createProject(clone(inp) as never), { bridgeThinStairGap: false }).candidates;
      expect(off.length).toBe(omit.length);
      off.forEach((c, i) => expect(writeDXF(c)).toBe(writeDXF(omit[i])));
    }
  });

  it('interactions: each existing option (and all six) + bridge never adds findings over that option alone', () => {
    const others = [
      { preferDiningKitchenAdjacency: true },
      { preferLShapeProgrammeAdjacency: true },
      { galleryDaylightAware: true },
      { connectStairCore: true },
      { programmeDoorCompletion: true },
      { stackPublicForDaylight: true },
      { preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true, galleryDaylightAware: true, connectStairCore: true, programmeDoorCompletion: true, stackPublicForDaylight: true },
    ];
    for (const inp of [FIX.rect14, FIX.rectE]) for (const o of others) {
      const alone = cand(inp, 'daylight-orientation', o);
      const both = cand(inp, 'daylight-orientation', { ...o, bridgeThinStairGap: true });
      noAdded(alone, both);
      expect(both.valid || !alone.valid).toBe(true);
      expect(n(both, 'CONSTRAINT_MUST_ADJACENT')).toBeLessThanOrEqual(n(alone, 'CONSTRAINT_MUST_ADJACENT'));
      expect(JSON.stringify(cand(inp, 'daylight-orientation', { ...o, bridgeThinStairGap: true }).floors)).toBe(JSON.stringify(both.floors));
    }
  });
});
