/**
 * Coordinated Rectangle planner P1 — pure building-frame derivation.
 * The module is not wired into production yet; these tests pin the frame contract.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveBuildingFrame, deriveRoomTargets, bandDepthDemand, bandWidthDemand,
  type BuildingFrame, type BuildingFrameInput, type FrameGeometry,
} from './building-frame.js';
import {
  CORRIDOR_W, CELL_QUALITY_DAYLIGHT_DEPTH, CELL_QUALITY_MIN_VOID, DINING_DAYLIGHT_MAX,
  buildAccessFrame, mainRoomDimensionTarget, room001Thresholds, stairPocketDepth, type PlacedSpec,
} from './placer.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { Rect } from '../geometry/rect.js';
import type { AccessSide } from '../model/site.js';
import type { CandidateStrategy } from '../model/layout.js';

type Building = Parameters<typeof allocateBuildingProgram>[0];
const villa = (o: Partial<Building> = {}): Building => ({
  type: 'villa', bedrooms: 1, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 0,
  kitchenType: 'open', hasStair: false, floors: 1, ...o,
} as Building);
/** Real programme specs per floor (the generator's programme path, stable placedIds). */
function floorSpecs(b: Building): PlacedSpec[][] {
  const n = Math.max(1, b.floors);
  return allocateBuildingProgram(b, n).map((al, l) =>
    programForFloor(b, l, n === 1, al).map((s, k) => ({ ...s, placedId: `${s.type}-${l}-${k}`, placedLabel: s.type }) as PlacedSpec));
}
const B1 = villa();
const B2_2F = villa({ bedrooms: 2, hasStair: true, floors: 2 });
const B3_4BD = villa({ bedrooms: 3, masterBedrooms: 1, bathrooms: 2, floors: 1 });
const STRATS: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'alternative-zoning'];
const SIDES: AccessSide[] = ['south', 'north', 'east', 'west'];
const E = 1e-6;

const inside = (r: Rect, o: Rect) =>
  r.x >= o.x - E && r.y >= o.y - E && r.x + r.w <= o.x + o.w + E && r.y + r.h <= o.y + o.h + E;
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > E && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > E;
const area = (r: Rect | null) => (r ? r.w * r.h : 0);
const geomRects = (g: FrameGeometry) =>
  [g.frame, g.publicBand, g.corridor, g.privateBand, g.entrySpur, g.kitchenStrip, g.residualRear, g.residualSide]
    .filter((r): r is Rect => r !== null);

function derive(slice: Rect, b: Building, o: Partial<BuildingFrameInput> = {}): BuildingFrame | null {
  return deriveBuildingFrame({ slice, access: 'south', strategy: 'area-efficiency', floorSpecs: floorSpecs(b), ...o });
}

/** Invariants every derived frame must satisfy. */
function expectSoundFrame(f: BuildingFrame): void {
  const L = f.local;
  // positive, finite, inside the slice (world and local)
  for (const r of [...geomRects(f.world), ...geomRects(L)]) {
    expect([r.x, r.y, r.w, r.h].every(Number.isFinite)).toBe(true);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  }
  for (const r of geomRects(f.world)) expect(inside(r, f.slice)).toBe(true);
  for (const r of geomRects(L)) expect(inside(r, L.slice)).toBe(true);
  // bands tile the frame: street → public → corridor → private (local frame, street at min-y)
  expect(L.publicBand.y).toBeCloseTo(L.frame.y, 9);
  expect(L.corridor.y).toBeCloseTo(L.publicBand.y + L.publicBand.h, 9);
  expect(L.privateBand.y).toBeCloseTo(L.corridor.y + L.corridor.h, 9);
  expect(L.privateBand.y + L.privateBand.h).toBeCloseTo(L.frame.y + L.frame.h, 9);
  expect(L.corridor.h).toBe(CORRIDOR_W);
  expect(L.publicBand.h).toBe(f.publicDepth);
  expect(L.privateBand.h).toBeCloseTo(f.privateDepth, 9);
  for (const r of [L.publicBand, L.corridor, L.privateBand]) {
    expect(r.x).toBeCloseTo(L.frame.x, 9);
    expect(r.w).toBeCloseTo(L.frame.w, 9);
  }
  for (const r of [L.entrySpur, L.kitchenStrip]) if (r) expect(inside(r, L.publicBand)).toBe(true);
  // the frame keeps the street edge of the slice
  expect(L.frame.y).toBeCloseTo(L.slice.y, 9);
  // residuals: disjoint from the frame and each other; frame + residuals tile the slice
  for (const r of [L.residualRear, L.residualSide]) if (r) {
    expect(overlaps(r, L.frame)).toBe(false);
    expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(CELL_QUALITY_MIN_VOID - E);
  }
  if (L.residualRear && L.residualSide) expect(overlaps(L.residualRear, L.residualSide)).toBe(false);
  expect(area(L.frame) + area(L.residualRear) + area(L.residualSide)).toBeCloseTo(L.slice.w * L.slice.h, 6);
  // world geometry is the local geometry mapped back through the P16-B access frame
  const af = buildAccessFrame(f.slice, f.access);
  const back = (r: Rect) => (af ? af.from(r) : r);
  expect(f.world.frame).toEqual(back(L.frame));
  expect(f.world.corridor).toEqual(back(L.corridor));
  // corridor line = world corridor, inside the slice
  const c = f.world.corridor;
  if (f.corridorLine.axis === 'y') {
    expect(f.corridorLine).toEqual({ axis: 'y', offset: c.y, width: c.h, from: c.x, to: c.x + c.w });
    expect(f.corridorLine.offset).toBeGreaterThan(f.slice.y);
    expect(f.corridorLine.offset + f.corridorLine.width).toBeLessThan(f.slice.y + f.slice.h);
  } else {
    expect(f.corridorLine).toEqual({ axis: 'x', offset: c.x, width: c.w, from: c.y, to: c.y + c.h });
    expect(f.corridorLine.offset).toBeGreaterThan(f.slice.x);
    expect(f.corridorLine.offset + f.corridorLine.width).toBeLessThan(f.slice.x + f.slice.w);
  }
  expect(f.corridorLine.width).toBe(CORRIDOR_W);
  expect(f.corridorFraction).toBeGreaterThan(0);
  expect(f.corridorFraction).toBeLessThan(1);
  expect(f.ladderCompatible).toBe(f.corridorFraction >= 0.30 && f.corridorFraction <= 0.70);
}

/** Every public / private band depth covers the contract depth of every room of that band. */
function expectProgrammeMinimums(f: BuildingFrame): void {
  for (const floor of f.targets) {
    for (const t of floor) {
      if (t.band === 'public') expect(f.publicDepth + E).toBeGreaterThanOrEqual(t.minDepth);
      if (t.band === 'private') expect(Math.max(f.publicDepth, f.privateDepth) + E).toBeGreaterThanOrEqual(t.minDepth);
    }
  }
}

describe('building frame (P1) — pure derivation', () => {
  it('normal rectangle: sound frame, programme-sized bands, all horizontal / L-spur strategies', () => {
    for (const strategy of STRATS) {
      const f = derive({ x: 2, y: 1.5, w: 14, h: 20.5 }, B1, { strategy });
      expect(f).not.toBeNull();
      expectSoundFrame(f!);
      expectProgrammeMinimums(f!);
      expect(f!.strategy).toBe(strategy);
      expect(f!.spine).toBe(strategy === 'area-efficiency' ? 'horizontal' : 'l-spur');
      expect(f!.world.entrySpur !== null).toBe(strategy !== 'area-efficiency');
      expect(f!.world.kitchenStrip).not.toBeNull();
      // band depths never exceed the P16-C daylight depth, so surplus depth is residual
      expect(f!.publicDepth).toBeLessThanOrEqual(CELL_QUALITY_DAYLIGHT_DEPTH + E);
      expect(f!.world.residualRear).not.toBeNull();
    }
  });

  it('decimal dimensions', () => {
    const f = derive({ x: 1.35, y: 2.15, w: 13.35, h: 21.7 }, B1);
    expect(f).not.toBeNull();
    expectSoundFrame(f!);
    expectProgrammeMinimums(f!);
    // depths on the placer's 1 cm grid
    expect(Math.abs(f!.publicDepth * 100 - Math.round(f!.publicDepth * 100))).toBeLessThan(1e-6);
  });

  it('narrow rectangle: a sound frame when the entry column fits, null when no band mode fits', () => {
    const ok = derive({ x: 2, y: 1.5, w: 8, h: 20 }, B1);
    expect(ok).not.toBeNull();
    expectSoundFrame(ok!);
    expectProgrammeMinimums(ok!);
    // 6 m wide with the widest (0.22) entrance spur: the public work band cannot host the programme
    expect(derive({ x: 2, y: 1.5, w: 6, h: 29.5 }, B1, { strategy: 'alternative-zoning' })).toBeNull();
  });

  it('deep rectangle: surplus depth becomes the rear residual, not room depth', () => {
    const f = derive({ x: 2, y: 1.5, w: 12, h: 40 }, B1);
    expect(f).not.toBeNull();
    expectSoundFrame(f!);
    expect(f!.world.residualRear).not.toBeNull();
    expect(f!.local.frame.h).toBeLessThan(f!.local.slice.h / 2);
    expect(f!.privateDepth).toBeLessThanOrEqual(CELL_QUALITY_DAYLIGHT_DEPTH + E);
  });

  it('large rectangle: living / dining sized from the programme; width surplus becomes the side residual', () => {
    const f = derive({ x: 2, y: 1.5, w: 21, h: 29.5 }, B1);
    expect(f).not.toBeNull();
    expectSoundFrame(f!);
    expect(f!.world.residualSide).not.toBeNull();
    expect(f!.world.residualRear).not.toBeNull();
    expect(area(f!.local.frame)).toBeLessThan(0.5 * 21 * 29.5);
  });

  it('asymmetric buildable slice (offset origin, unequal sides)', () => {
    for (const access of SIDES) {
      const f = derive({ x: 3.2, y: 0.8, w: 11.4, h: 19.6 }, B2_2F, { access, upperFloorFrontPrivate: true });
      expect(f).not.toBeNull();
      expectSoundFrame(f!);
      expectProgrammeMinimums(f!);
    }
  });

  it('all four access sides: the public band sits on the access edge of the slice', () => {
    const slice = { x: 2, y: 1.5, w: 14, h: 20.5 };
    for (const access of SIDES) {
      const f = derive(slice, B1, { access });
      expect(f).not.toBeNull();
      expectSoundFrame(f!);
      const p = f!.world.publicBand;
      if (access === 'south') expect(p.y).toBeCloseTo(slice.y, 9);
      if (access === 'north') expect(p.y + p.h).toBeCloseTo(slice.y + slice.h, 9);
      if (access === 'west') expect(p.x).toBeCloseTo(slice.x, 9);
      if (access === 'east') expect(p.x + p.w).toBeCloseTo(slice.x + slice.w, 9);
      expect(f!.corridorLine.axis).toBe(access === 'south' || access === 'north' ? 'y' : 'x');
    }
    // north is the mirror of south: same depths, same corridor fraction
    const s = derive(slice, B1, { access: 'south' })!;
    const n = derive(slice, B1, { access: 'north' })!;
    expect([n.publicDepth, n.privateDepth, n.corridorFraction]).toEqual([s.publicDepth, s.privateDepth, s.corridorFraction]);
    // east / west use the transposed local frame: identical local geometry on both
    const e = derive(slice, B1, { access: 'east' })!;
    const w = derive(slice, B1, { access: 'west' })!;
    expect(e.local.frame).toEqual(w.local.frame);
    expect(e.local.slice).toEqual({ x: slice.x, y: slice.y, w: slice.h, h: slice.w });
  });

  it('programme minimums: stair pocket depth, main-room width floor, dining ceiling', () => {
    const f = derive({ x: 2, y: 1.5, w: 14, h: 20.5 }, B2_2F, { upperFloorFrontPrivate: true });
    expect(f).not.toBeNull();
    expectSoundFrame(f!);
    expectProgrammeMinimums(f!);
    expect(f!.privateDepth + E).toBeGreaterThanOrEqual(stairPocketDepth(f!.privateDepth));
    expect(f!.targets).toHaveLength(2);

    const th = room001Thresholds(true)!;
    for (const floor of [...floorSpecs(B1), ...floorSpecs(B2_2F)]) {
      const main = mainRoomDimensionTarget(floor, true);
      const plainF = deriveRoomTargets(floor, true);
      const raisedF = deriveRoomTargets(floor, true, true);
      raisedF.forEach((t, i) => {
        if (main && t.placedId === main.placedId) expect(t.widthFloor).toBe(Math.max(th.width, plainF[i].minWidth));
        else expect(t.widthFloor).toBe(plainF[i].widthFloor);
        expect(plainF[i].widthFloor).toBe(plainF[i].minWidth);
      });
    }
    const specs = floorSpecs(B1)[0];
    const plain = deriveRoomTargets(specs, true);
    const dining = plain.find(t => t.type === 'dining')!;
    expect(dining.maxDimension).toBe(DINING_DAYLIGHT_MAX);
    expect(dining.band).toBe('public');
    for (const t of plain) {
      const s = specs.find(x => x.placedId === t.placedId)!;
      expect(t.minArea).toBeGreaterThanOrEqual(s.minArea ?? 0);
      expect(t.targetArea).toBeGreaterThanOrEqual(t.minArea);
    }
  });

  it('band demand helpers: depth within extent, width ≥ minimums, stacked modes have no width demand', () => {
    const pub = deriveRoomTargets(floorSpecs(B1)[0], true).filter(t => t.band === 'public');
    for (const [w, ext] of [[11.6, 9], [6.3, 12], [20, 5]] as const) {
      const d = bandDepthDemand(pub, w, ext);
      expect(d).not.toBeNull();
      expect(d!.depth).toBeLessThanOrEqual(ext + E);
      expect(d!.depth + E).toBeGreaterThanOrEqual(Math.max(...pub.map(t => t.minDepth)));
      const need = bandWidthDemand(pub, d!.depth, d!.mode);
      if (d!.mode === 'entry-stack' || d!.mode === 'column') expect(need).toBeNull();
      else expect(need! + E).toBeGreaterThanOrEqual(Math.max(...pub.map(t => t.widthFloor)));
    }
    expect(bandDepthDemand(pub, 2, 3)).toBeNull();
    expect(bandDepthDemand([], 5, 5)).toEqual({ mode: 'row', depth: 0 });
    expect(bandDepthDemand(pub, 0, 5)).toBeNull();
  });

  it('corridor line inside bounds and public / private depths valid across the strategies and sides', () => {
    for (const strategy of STRATS) for (const access of SIDES) for (const b of [B1, B2_2F, B3_4BD]) {
      const f = derive({ x: 2, y: 1.5, w: 15, h: 22 }, b, { strategy, access, upperFloorFrontPrivate: true });
      expect(f).not.toBeNull();
      expectSoundFrame(f!);
      expectProgrammeMinimums(f!);
      expect(f!.publicDepth).toBeGreaterThanOrEqual(1.2);
      expect(f!.privateDepth).toBeGreaterThanOrEqual(1.2);
      expect(f!.publicDepth + CORRIDOR_W + f!.privateDepth).toBeCloseTo(f!.local.frame.h, 9);
    }
  });

  it('invalid / insufficient geometry → null', () => {
    const specs = floorSpecs(B1);
    const base = { access: 'south' as const, strategy: 'area-efficiency' as const, floorSpecs: specs };
    for (const slice of [
      { x: 0, y: 0, w: 0, h: 20 }, { x: 0, y: 0, w: 14, h: -3 }, { x: 0, y: 0, w: Number.NaN, h: 20 },
      { x: Number.POSITIVE_INFINITY, y: 0, w: 14, h: 20 }, { x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 0, w: 14, h: 5 },
    ]) expect(deriveBuildingFrame({ ...base, slice })).toBeNull();
    const slice = { x: 2, y: 1.5, w: 14, h: 20.5 };
    expect(deriveBuildingFrame({ ...base, slice, floorSpecs: [] })).toBeNull();
    expect(deriveBuildingFrame({ ...base, slice, floorSpecs: [[]] })).toBeNull();
    expect(deriveBuildingFrame({ ...base, slice, strategy: 'daylight-orientation' })).toBeNull(); // vertical spine: not in P1
    expect(deriveBuildingFrame({ ...base, slice, access: 'up' as unknown as AccessSide })).toBeNull();
  });

  it('deterministic and pure: repeated derivations are identical and the input is not mutated', () => {
    for (const access of SIDES) {
      const input: BuildingFrameInput = {
        slice: { x: 1.35, y: 2.15, w: 13.35, h: 21.7 }, access, strategy: 'functional-circulation',
        floorSpecs: floorSpecs(B2_2F), upperFloorFrontPrivate: true,
      };
      const before = JSON.stringify(input);
      const a = deriveBuildingFrame(input);
      const b = deriveBuildingFrame(input);
      const c = deriveBuildingFrame(JSON.parse(before));
      expect(a).not.toBeNull();
      expect(JSON.stringify(input)).toBe(before);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    }
  });
});
