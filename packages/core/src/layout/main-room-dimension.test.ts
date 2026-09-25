/**
 * Phase 5.5C — opt-in `mainRoomMinDimension` (generic private-band sizing).
 *
 * MBH4-ROOM-001 (§7-1-1-8) needs at least one main room per floor with BOTH the area and
 * the width threshold. The placer's main-habitable preference aimed only at the area, so
 * top-floor bedrooms landed 0.02–0.20 m short of 2.70 m while band slack stayed void. With
 * the option on, the largest qualifying main room's planning minimum is raised to the
 * pack's width threshold from band slack only; the generator adopts the variant only
 * through adoptMainRoomDimensionVariant. OFF must be byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  placeSpaces, mainRoomDimensionTarget, room001Thresholds, MAIN_ROOM_DIMENSION_APPLIED, type PlacedSpec,
} from './placer.js';
import { generateLayouts, adoptMainRoomDimensionVariant } from '../generator/generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import type { Space, SpaceType, Zone } from '../model/space.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import type { ProjectInput } from '../model/project.js';

type Out = { spaces: Space[]; corridors: Space[]; explanation: string[] };
const ADOPTED = 'Phase 5.5C: main-room minimum-dimension variant adopted';
const RULE = 'MBH4-ROOM-001';

const mkSpace = (type: SpaceType, r: Rect, label: string, id: string, zone: Zone): Space => ({
  id, type, label, zone, privacy: zone === 'circulation' ? 'service' : zone,
  polygon: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
  rect: { ...r }, area: r.w * r.h, targetArea: r.w * r.h, minArea: 0,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
}) as unknown as Space;
function spec(type: SpaceType, minArea: number, targetArea: number, minWidth: number, privacy: 'public' | 'service' | 'private', id = `${type}-x`): PlacedSpec {
  return { type, minArea, targetArea, minWidth, privacy, priority: 5, placedId: id, placedLabel: type } as PlacedSpec;
}
/** Generic upper floors (programme minimums from TYPICAL_AREAS). */
const SINGLE = [spec('stair-hall', 4.5, 6, 1.2, 'service'), spec('bedroom', 9, 12, 2.5, 'private')];
const PAIR = [spec('stair-hall', 4.5, 6, 1.2, 'service'), spec('master-bedroom', 12, 14, 2.5, 'private'), spec('master-bathroom', 3, 4, 1.5, 'private')];
const TWO = [spec('stair-hall', 4.5, 6, 1.2, 'service'), spec('bedroom', 9, 12, 2.5, 'private', 'bedroom-a'),
  spec('bedroom', 9, 12, 2.5, 'private', 'bedroom-b'), spec('bathroom', 2.4, 3.6, 1.3, 'private')];
const fp = (w: number, h: number): Rect => ({ x: 0, y: 0, w, h });
const place = (specs: PlacedSpec[], f: Rect, strategy: string, on?: boolean): Out => on === undefined
  ? placeSpaces(f, specs, strategy as never, 'south', mkSpace)
  : placeSpaces(f, specs, strategy as never, 'south', mkSpace, { mainRoomMinDimension: on });
const room = (o: Out, id: string) => o.spaces.find(s => s.id === id)!;
const short = (s: Space) => Math.min(s.rect.w, s.rect.h);
const fired = (o: Out) => o.explanation.some(e => e.startsWith(MAIN_ROOM_DIMENSION_APPLIED));
const noOverlap = (rs: Rect[]) => rs.every((p, i) => rs.every((q, j) => j <= i ||
  !(Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1e-6 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1e-6)));

describe('Phase 5.5C — thresholds and target selection', () => {
  it('reads the verified MBH4-ROOM-001 thresholds from the regulation pack', () => {
    expect(room001Thresholds(true)).toEqual({ area: 12, width: 2.7 });
    expect(room001Thresholds(false)).toEqual({ area: 9, width: 2.5 });
  });

  it('picks the largest main room meeting the area threshold, deterministically (placedId ties)', () => {
    expect(mainRoomDimensionTarget(TWO, true)).toEqual({ placedId: 'bedroom-a', width: 2.7, area: 12 });
    expect(mainRoomDimensionTarget([...TWO].reverse(), true)?.placedId).toBe('bedroom-a');
    expect(mainRoomDimensionTarget(PAIR, true)?.placedId).toBe('master-bedroom-x');
    // no main room → nothing to size; small unit whose rooms plan below 9 m² → none qualifies
    expect(mainRoomDimensionTarget([spec('stair-hall', 4.5, 6, 1.2, 'service')], true)).toBeNull();
    expect(mainRoomDimensionTarget([spec('bedroom', 6, 8, 2.2, 'private')], false)).toBeNull();
  });
});

describe('Phase 5.5C — horizontal / l-spur column sizing', () => {
  it('representative 14×17 top floor: a 2.50 m bedroom reaches 2.70 m from band slack', () => {
    for (const st of ['area-efficiency', 'functional-circulation']) {
      const off = place(SINGLE, fp(14, 17), st), on = place(SINGLE, fp(14, 17), st, true);
      expect(short(room(off, 'bedroom-x'))).toBeLessThan(2.7);
      expect(short(room(on, 'bedroom-x'))).toBeGreaterThanOrEqual(2.7 - 1e-9);
      expect(room(on, 'bedroom-x').area).toBeGreaterThanOrEqual(12);
      expect(fired(on)).toBe(true);
      expect(fired(off)).toBe(false);
      // stair hall untouched; nothing overlaps
      expect(room(on, 'stair-hall-x').rect).toEqual(room(off, 'stair-hall-x').rect);
      expect(noOverlap(on.spaces.map(s => s.rect))).toBe(true);
    }
  });

  it('paired ensuite column: the master bedroom reaches 2.70 m; the ensuite keeps its minimum', () => {
    const off = place(PAIR, fp(14, 17), 'area-efficiency'), on = place(PAIR, fp(14, 17), 'area-efficiency', true);
    expect(short(room(off, 'master-bedroom-x'))).toBeLessThan(2.7);
    expect(short(room(on, 'master-bedroom-x'))).toBeGreaterThanOrEqual(2.7 - 1e-9);
    const bath = room(on, 'master-bathroom-x');
    expect(short(bath)).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(short(bath)).toBeGreaterThanOrEqual(short(room(off, 'master-bathroom-x')) - 1e-9);
    expect(noOverlap(on.spaces.map(s => s.rect))).toBe(true);
  });

  it('neighbours: only the chosen room is raised; every other room keeps its programme minimum', () => {
    const off = place(TWO, fp(14, 17), 'area-efficiency'), on = place(TWO, fp(14, 17), 'area-efficiency', true);
    expect(short(room(on, 'bedroom-a'))).toBeGreaterThanOrEqual(2.7 - 1e-9);
    expect(short(room(on, 'bedroom-b'))).toBeCloseTo(short(room(off, 'bedroom-b')), 6);
    for (const s of on.spaces) {
      const sp = TWO.find(x => x.placedId === s.id)!;
      expect(short(s)).toBeGreaterThanOrEqual((sp.minWidth ?? 0) - 1e-9);
      expect(s.area).toBeGreaterThanOrEqual(sp.minArea - 1e-9);
    }
    expect(room(on, 'stair-hall-x').rect).toEqual(room(off, 'stair-hall-x').rect);
    expect(noOverlap(on.spaces.map(s => s.rect))).toBe(true);
  });

  it('insufficient band slack: no raise, output identical to OFF', () => {
    const off = place(TWO, fp(8, 16), 'area-efficiency'), on = place(TWO, fp(8, 16), 'area-efficiency', true);
    expect(fired(on)).toBe(false);
    expect(on).toEqual(off);
  });
});

describe('Phase 5.5C — vertical row sizing (mainPrefH mirror)', () => {
  it('a 2.56 m-deep bedroom row reaches 2.70 m from band slack', () => {
    const off = place(TWO, fp(16, 12), 'daylight-orientation'), on = place(TWO, fp(16, 12), 'daylight-orientation', true);
    expect(short(room(off, 'bedroom-a'))).toBeLessThan(2.7);
    expect(short(room(on, 'bedroom-a'))).toBeGreaterThanOrEqual(2.7 - 1e-9);
    expect(fired(on)).toBe(true);
    for (const s of on.spaces) {
      const sp = TWO.find(x => x.placedId === s.id)!;
      expect(short(s)).toBeGreaterThanOrEqual((sp.minWidth ?? 0) - 1e-9);
    }
    expect(room(on, 'stair-hall-x').rect).toEqual(room(off, 'stair-hall-x').rect);
    expect(noOverlap(on.spaces.map(s => s.rect))).toBe(true);
  });

  it('a band narrower than the rule width cannot help: no raise, identical to OFF', () => {
    const off = place(SINGLE, fp(6.2, 16), 'daylight-orientation'), on = place(SINGLE, fp(6.2, 16), 'daylight-orientation', true);
    expect(fired(on)).toBe(false);
    expect(on).toEqual(off);
  });

  it('is deterministic and OFF (omitted / false) is identical', () => {
    for (const st of ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning']) {
      for (const specs of [SINGLE, PAIR, TWO]) {
        expect(place(specs, fp(14, 17), st, false)).toEqual(place(specs, fp(14, 17), st));
        expect(place(specs, fp(14, 17), st, true)).toEqual(place(specs, fp(14, 17), st, true));
      }
    }
  });
});

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const RSITE = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
/** Benchmark rect / b3lift / seed 42 — the diagnosed 2.56 m top-floor bedroom. */
const BENCH = { site: RSITE, building: { type: 'villa', bedrooms: 3, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, hasElevator: true, floors: 3 }, seed: 42, deterministic: true, jurisdiction: 'IR' };
/** A generic L-shape three-storey villa whose wing top floor is short of 2.70 m. */
const LSITE = {
  site: { shape: 'l-shape', width: 23.64, length: 24.62, streetWidth: 8.09, accessSide: 'west', setbackNorth: 0.55, setbackSouth: 1.35, setbackEast: 1.72, setbackWest: 1.26,
    lShape: { width: 23.64, length: 24.62, notchWidth: 4.31, notchLength: 6.42, notchCorner: 'south-west' } },
  building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0, kitchenType: 'closed', hasStair: true, floors: 3, hasElevator: false, hasStorage: false },
  seed: 37, deterministic: true, jurisdiction: 'IR',
};
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
/** Every earlier opt-in (5.2–5.5B), for the after-the-chain integration check. */
const CHAIN = { programmeDoorCompletion: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true, galleryDaylightAware: true, connectStairCore: true,
  stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true, diningFacadeRow: true, rotateShallowStairPocket: true };
const run = (inp: unknown, o: Record<string, boolean> = {}) => generateLayouts(clone(inp) as ProjectInput, [...STRATS], o);
const byStrat = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const roomHard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard' && f.code === RULE).length;
const hardN = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').length;
const sig = (c: LayoutCandidate) => JSON.stringify({ floors: c.floors, findings: c.findings, valid: c.valid, explanations: c.explanations });

describe('Phase 5.5C — generator integration', () => {
  it('benchmark rect/b3lift/42: the 2.56 m top-floor bedroom reaches 2.70 m and the variant is adopted', () => {
    const off = byStrat(run(BENCH), 'area-efficiency');
    const on = byStrat(run(BENCH, { mainRoomMinDimension: true }), 'area-efficiency');
    const bed = (c: LayoutCandidate) => c.floors[2].spaces.find(s => s.type === 'bedroom')!;
    expect(short(bed(off))).toBeCloseTo(2.56, 6);
    expect(roomHard(off)).toBe(1);
    expect(on.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
    expect(short(bed(on))).toBeGreaterThanOrEqual(2.7 - 1e-9);
    expect(roomHard(on)).toBe(0);
    expect(hardN(on)).toBeLessThan(hardN(off));
    // stair / elevator halls are not moved on any floor
    for (const L of [0, 1, 2]) for (const t of ['stair-hall', 'elevator-hall']) {
      expect(on.floors[L].spaces.find(s => s.type === t)?.rect).toEqual(off.floors[L].spaces.find(s => s.type === t)?.rect);
    }
    for (const fl of on.floors) expect(noOverlap(fl.spaces.filter(s => s.type !== 'corridor').map(s => s.rect))).toBe(true);
  });

  it('after the whole 5.2–5.5B chain the same candidate becomes HARD-valid', () => {
    const off = byStrat(run(BENCH, CHAIN), 'area-efficiency');
    const on = byStrat(run(BENCH, { ...CHAIN, mainRoomMinDimension: true }), 'area-efficiency');
    expect(off.valid).toBe(false);
    expect(off.findings.filter(f => f.severity === 'hard').map(f => f.code)).toEqual([RULE]);
    expect(on.valid).toBe(true);
    expect(hardN(on)).toBe(0);
  });

  it('L-shape: the option is forwarded to the wing placer; adopted candidates reduce ROOM-001, others are unchanged', () => {
    const off = run(LSITE), on = run(LSITE, { mainRoomMinDimension: true });
    let adopted = 0;
    for (const c of on) {
      const b = byStrat(off, c.metadata.strategy);
      if (!c.explanations.some(e => e.startsWith(ADOPTED))) { expect(sig(c)).toBe(sig(b)); continue; }
      adopted++;
      expect(c.explanations.some(e => e.includes(MAIN_ROOM_DIMENSION_APPLIED) && e.startsWith('['))).toBe(true);   // wing-prefixed placer marker
      expect(roomHard(c)).toBeLessThan(roomHard(b));
      expect(hardN(c)).toBeLessThan(hardN(b));
    }
    expect(adopted).toBeGreaterThanOrEqual(1);
  });

  it('OFF (omitted / false) is identical to baseline; deterministic when ON', () => {
    for (const inp of [BENCH, LSITE]) {
      const base = run(inp).map(sig);
      expect(run(inp, { mainRoomMinDimension: false }).map(sig)).toEqual(base);
      expect(run(inp, { mainRoomMinDimension: true }).map(sig)).toEqual(run(inp, { mainRoomMinDimension: true }).map(sig));
    }
  });

  it('pipeline: DXF output with the option omitted / false is byte-identical', () => {
    const dxf = (o?: Record<string, boolean>) => writeDXF(generate(createProject(clone(BENCH) as never), o as never).candidates[0]);
    expect(dxf({ mainRoomMinDimension: false })).toBe(dxf());
  });
});

describe('Phase 5.5C — adoptMainRoomDimensionVariant guard', () => {
  const F = (code: string, severity: 'hard' | 'soft' = 'hard'): Finding => ({ code, severity, message: code } as unknown as Finding);
  const sp = (id: string, r: Rect, minWidth = 1, minArea = 1) => ({ id, type: 'bedroom', rect: r, area: r.w * r.h, minWidth, minArea });
  const FLOOR = [sp('bed', { x: 0, y: 0, w: 2.56, h: 7 }, 2.5, 9), sp('bath', { x: 2.56, y: 0, w: 2, h: 3 }, 1.5, 2.4)];
  const cand = (findings: Finding[], valid = false, raised = true, spaces: unknown[] = FLOOR): LayoutCandidate =>
    ({ findings, valid, explanations: raised ? [`${MAIN_ROOM_DIMENSION_APPLIED}: bed`] : [], floors: [{ level: 0, spaces }],
      buildableRects: [{ x: 0, y: 0, w: 20, h: 20 }] } as unknown as LayoutCandidate);
  const base = () => cand([F(RULE), F('ROOM_CONSTRAINT_MIN_AREA')], false, false);
  const WIDE = [sp('bed', { x: 0, y: 0, w: 2.7, h: 7 }, 2.5, 9), sp('bath', { x: 2.7, y: 0, w: 2, h: 3 }, 1.5, 2.4)];

  it('adopts when ROOM-001 and HARD strictly fall with nothing else added', () => {
    const v = cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, WIDE);
    expect(adoptMainRoomDimensionVariant(base(), v)).toBe(v);
    expect(v.explanations.some(e => e.startsWith(ADOPTED))).toBe(true);
  });
  it('rejects without the placer marker', () => {
    const b = base();
    expect(adoptMainRoomDimensionVariant(b, cand([], false, false, WIDE))).toBe(b);
  });
  it('rejects when ROOM-001 HARD does not strictly fall', () => {
    const b = base();
    expect(adoptMainRoomDimensionVariant(b, cand([F(RULE)], false, true, WIDE))).toBe(b);
    // a soft ROOM-001 is not the HARD
    expect(adoptMainRoomDimensionVariant(b, cand([F(RULE), F(RULE, 'soft')], false, true, WIDE))).toBe(b);
  });
  it('rejects when total HARD does not strictly fall', () => {
    const b = base();
    expect(adoptMainRoomDimensionVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA'), F('ROOM_CONSTRAINT_MIN_AREA')], false, true, WIDE))).toBe(b);
  });
  it('rejects any other HARD code increase', () => {
    const b = base();
    expect(adoptMainRoomDimensionVariant(b, cand([F('ELEV_SHAFT_MISALIGNED')], false, true, WIDE))).toBe(b);
  });
  it('rejects a circulation / access / daylight increase at any severity', () => {
    const b = cand([F(RULE), F('X_HARD')], false, false);
    for (const code of ['CIRCULATION_DEAD_END', 'CIRC_ROOM_THROUGH_ROOM', 'CONSTRAINT_DIRECT_ACCESS', 'ACCESSIBILITY_ROUTE', 'ROOM_DAYLIGHT_QUALITY', 'MBH4-DYL-001']) {
      expect(adoptMainRoomDimensionVariant(b, cand([F(code, 'soft')], false, true, WIDE))).toBe(b);
    }
  });
  it('never turns a valid candidate invalid', () => {
    const b = cand([F(RULE), F('X_HARD'), F('Y_HARD')], true, false);
    expect(adoptMainRoomDimensionVariant(b, cand([F('X_HARD')], false, true, WIDE))).toBe(b);
  });
  it('rejects a new overlap or a room pushed outside the buildable area', () => {
    const b = base();
    const overlap = [sp('bed', { x: 0, y: 0, w: 2.7, h: 7 }, 2.5, 9), sp('bath', { x: 2.56, y: 0, w: 2, h: 3 }, 1.5, 2.4)];
    expect(adoptMainRoomDimensionVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, overlap))).toBe(b);
    const outside = [sp('bed', { x: -0.14, y: 0, w: 2.7, h: 7 }, 2.5, 9), FLOOR[1]];
    expect(adoptMainRoomDimensionVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, outside))).toBe(b);
  });
  it('rejects a neighbour shrunk below its own minimum width or area', () => {
    const b = base();
    const narrow = [sp('bed', { x: 0, y: 0, w: 2.7, h: 7 }, 2.5, 9), sp('bath', { x: 2.7, y: 0, w: 1.4, h: 3 }, 1.5, 2.4)];
    expect(adoptMainRoomDimensionVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, narrow))).toBe(b);
    const small = [sp('bed', { x: 0, y: 0, w: 2.7, h: 7 }, 2.5, 9), sp('bath', { x: 2.7, y: 0, w: 2, h: 1.1 }, 1, 2.4)];
    expect(adoptMainRoomDimensionVariant(b, cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, small))).toBe(b);
    // shrinking while staying at/above the minimum is allowed
    const ok = [sp('bed', { x: 0, y: 0, w: 2.7, h: 7 }, 2.5, 9), sp('bath', { x: 2.7, y: 0, w: 1.86, h: 3 }, 1.5, 2.4)];
    const v = cand([F('ROOM_CONSTRAINT_MIN_AREA')], false, true, ok);
    expect(adoptMainRoomDimensionVariant(b, v)).toBe(v);
  });
});
