/**
 * P10 — the coordinated planner's bounded vertical target-length retry. On a vertical-spine
 * (daylight-orientation) frame, P7's frame is carveZones' own zoning over the whole slice, so
 * the coordinated variant reproduces legacy and the guard's strict-gain condition (G11)
 * rejects it. After every P4 / P5 attempt (including P8 and P9) was rejected on such a
 * frame, the frame is cut ONCE to its target-sized column length:
 * BuildingFrameInput.verticalTargetLength.
 * - The public column needs its public / semi-private RoomTargets.targetArea along the band
 *   width, plus the kitchen pocket.
 * - The length then grows in 1 cm steps until bandCanHost holds for every floor.
 * - Zones are carved on the full slice (stair / lift / storage pockets unchanged) and end
 *   at the cut. The kitchen pocket keeps its size and moves to the new rear end, and the
 *   rest becomes the rear residual.
 * The build goes through the unchanged P6 checks and adoption guard; failure → exact legacy.
 * Opt-in only (coordinatedRectPlanner). Cases are the existing benchmark / sweep inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { fn: 'place' | 'plan'; vertical: boolean; noSideResidual: boolean; targetPublicDepth: boolean };
const calls = vi.hoisted(() => [] as Call[]);
vi.mock('../layout/coordinated-rect.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layout/coordinated-rect.js')>();
  const rec = (fn: Call['fn'], r: { verticalTargetLength?: boolean; noSideResidual?: boolean; targetPublicDepth?: boolean }) =>
    calls.push({ fn, vertical: r.verticalTargetLength === true, noSideResidual: r.noSideResidual === true, targetPublicDepth: r.targetPublicDepth === true });
  return {
    ...actual,
    placeCoordinatedRect: (...a: Parameters<typeof actual.placeCoordinatedRect>) => { rec('place', a[0]); return actual.placeCoordinatedRect(...a); },
    planCoordinatedCore: (...a: Parameters<typeof actual.planCoordinatedCore>) => { rec('plan', a[0]); return actual.planCoordinatedCore(...a); },
  };
});

import { generateLayouts } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import {
  COORDINATED_RESIDUAL_APPLIED, COORDINATED_RESIDUAL_RETRY, COORDINATED_TARGET_RETRY, COORDINATED_VERTICAL_RETRY,
  verticalFloorZones,
} from '../layout/coordinated-rect.js';
import { deriveBuildingFrame, deriveRoomTargets, type BuildingFrame } from '../layout/building-frame.js';
import { bandCanHost } from '../layout/topology.js';
import { strictifyBandCells, verticalSpineFits, zoneBandCells, zoneOf, zoneUnitIsLarge } from '../layout/placer.js';
import { floorWallPad } from '../layout/compaction.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy, Floor } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Rect } from '../geometry/rect.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const DAY: CandidateStrategy = 'daylight-orientation';
const ALL = [...benchmarkInputs(), ...sweepInputs()];
const inputOf = (id: string): ProjectInput => structuredClone(ALL.find(b => b.id === id)!.input);
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const off = (id: string, st: CandidateStrategy[] = S) => generateLayouts(inputOf(id), st, { upperFloorFrontPrivate: true });
const on = (id: string, st: CandidateStrategy[] = S) =>
  generateLayouts(inputOf(id), st, { upperFloorFrontPrivate: true, coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => /^P[45]: coordinated .* adopted/.test(e));
const isVertical = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(COORDINATED_VERTICAL_RETRY));
const verticalCalls = () => calls.filter(c => c.vertical);

const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').length;
const count = (c: LayoutCandidate, re: RegExp) => c.findings.filter(f => re.test(f.code)).length;
const CIRC = /CIRC/;
const ACCESS = /ACCESS|REACH|INACCESS/;
const DAYLIGHT = /DAYLIGHT|DYL/;
const CIRCULATION_TYPES = new Set(['corridor', 'stair-hall', 'entrance', 'foyer', 'elevator-hall']);
const programme = (c: LayoutCandidate) => c.floors.map(f =>
  f.spaces.filter(s => !CIRCULATION_TYPES.has(s.type)).map(s => s.type).sort().join(','));
const verticalGeometry = (c: LayoutCandidate) => c.floors.map(f => ({
  stairs: f.stairs.map(s => [s.footprint.x.toFixed(3), s.footprint.y.toFixed(3), s.footprint.w.toFixed(3), s.footprint.h.toFixed(3), s.flights.length, s.totalRisers, s.treadDepth]),
  elevators: f.elevators.map(e => [e.rect.x.toFixed(3), e.rect.y.toFixed(3), e.rect.w.toFixed(3), e.rect.h.toFixed(3)]),
}));
const maxRoom = (c: LayoutCandidate) =>
  Math.max(...c.floors.flatMap(f => f.spaces.filter(s => s.type !== 'corridor').map(s => s.area ?? s.rect.w * s.rect.h)));
const dev = (c: LayoutCandidate) => c.floors.reduce((d, f) => d + f.spaces
  .filter(s => (s.type === 'living' || s.type === 'dining') && typeof s.targetArea === 'number' && s.targetArea > 0)
  .reduce((a, s) => a + Math.abs(s.area - s.targetArea!) / s.targetArea!, 0), 0);
const overlapArea = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-3 && h > 1e-3 ? w * h : 0;
};
const occupied = (f: Floor): Rect[] => [
  ...f.spaces.filter(s => s.type !== 'yard').map(s => s.rect),
  ...f.stairs.map(s => s.footprint), ...f.elevators.map(e => e.rect),
  ...(f.parkingStalls ?? []).map(p => p.rect),
  ...(f.parkingArea?.aisleRect ? [f.parkingArea.aisleRect] : []),
];

/**
 * Independent residual check (south access): every floor carries its P6 note with a rear
 * strip. The strip sits on the buildable's rear (max-y) edge, and no room / core / parking
 * rect or compacted envelope enters it beyond the exterior-wall pad.
 */
function expectRearResidualOpen(c: LayoutCandidate) {
  const E = 0.011; // the note prints centimetres
  const b = c.buildableArea as Rect;
  for (const f of c.floors) {
    const note = c.explanations.find(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level ${f.level} `));
    expect(note, `level ${f.level} P6 note`).toBeDefined();
    const m = note!.match(/rear (none|([\d.]+)×([\d.]+) m), side (none|[\d.×]+ m)/)!;
    expect(m[1], 'a cut vertical frame leaves a rear strip').not.toBe('none');
    expect(m[4], 'the vertical frame has no side strip').toBe('none');
    const pad = floorWallPad(f);
    const rear: Rect = { x: b.x + E, y: b.y + b.h - Number(m[3]) + pad + E, w: Number(m[2]) - 2 * E, h: Number(m[3]) - pad - 2 * E };
    for (const o of occupied(f)) expect(overlapArea(o, rear), `level ${f.level} rect in the rear residual`).toBe(0);
    expect(overlapArea(f.footprint, rear), `level ${f.level} envelope in the rear residual`).toBe(0);
  }
}

/** The P10 acceptance properties of a vertical-retry-adopted candidate against its legacy candidate. */
function expectSafeVertical(v: LayoutCandidate, base: LayoutCandidate) {
  expect(isAdopted(v)).toBe(true);
  expect(isVertical(v)).toBe(true);
  expect(hard(v)).toBeLessThanOrEqual(hard(base));
  if (base.valid) expect(v.valid).toBe(true);
  for (const re of [CIRC, ACCESS, DAYLIGHT]) expect(count(v, re), String(re)).toBeLessThanOrEqual(count(base, re));
  expect(programme(v)).toEqual(programme(base));
  expect(verticalGeometry(v)).toEqual(verticalGeometry(base));
  expect(maxRoom(v)).toBeLessThanOrEqual(60);
  expect(dev(v)).toBeLessThan(dev(base)); // the guard's strict living / dining gain (G11)
  expect((v.floors[0].parkingStalls ?? []).length).toBe((base.floors[0].parkingStalls ?? []).length);
  expectRearResidualOpen(v);
}

beforeEach(() => { calls.length = 0; });

// ---------------------------------------------------------------------------------------
// Frame level (pure)
// ---------------------------------------------------------------------------------------

const specsOf = (id: string) => {
  const b = inputOf(id).building;
  const n = b.floors;
  const al = allocateBuildingProgram(b, n);
  return al.map((a, l) => programForFloor(b, l, n === 1, a)
    .map((s, k) => ({ ...s, placedId: `${s.type}-${l}-${k}`, placedLabel: s.type }) as PlacedSpec));
};
const SLICE: Rect = { x: 2, y: 1.5, w: 10, h: 17.5 };
const frameOf = (floorSpecs: PlacedSpec[][], verticalTargetLength?: boolean): BuildingFrame | null => deriveBuildingFrame({
  slice: SLICE, access: 'south', strategy: DAY, floorSpecs, verticalSpine: true,
  ...(verticalTargetLength === undefined ? {} : { verticalTargetLength }),
});

/** Independent restatement of the length rule. */
function lengthRule(frame: BuildingFrame, floorSpecs: PlacedSpec[][]) {
  const L = frame.local.slice;
  const large = zoneUnitIsLarge(L);
  const pubW = frame.local.publicBand.w, privW = frame.local.privateBand.w;
  const zones = floorSpecs.map(specs => verticalFloorZones(frame, specs));
  const cells = floorSpecs.map(specs => {
    const pubR = zoneBandCells(specs, ['public', 'semi-private']), privR = zoneBandCells(specs, ['private']);
    return { pubR, privR, pub: strictifyBandCells(pubR, large), priv: strictifyBandCells(privR, large) };
  });
  const flags = floorSpecs.map(specs => ({
    needStair: specs.some(s => s.type === 'stair-hall'), hasKitchen: specs.some(s => s.type === 'kitchen'), hasStorage: specs.some(s => s.type === 'storage'),
  }));
  const strict = floorSpecs.every((_, l) => verticalSpineFits(L, frame.corridorFraction, flags[l].needStair, flags[l].hasKitchen, flags[l].hasStorage, cells[l].pub, cells[l].priv));
  const per = floorSpecs.map((specs, l) => {
    const pub = zones[l].zones.public[0], priv = zones[l].zones.private[0];
    const targets = deriveRoomTargets(specs, large).filter(t => {
      const z = zoneOf(specs.find(s => s.placedId === t.placedId)!);
      return (z === 'public' || z === 'semi-private') && t.type !== 'yard' && t.type !== 'balcony';
    });
    return {
      kitchenH: L.h - pub.h, southH: priv.y - L.y,
      need: targets.reduce((a, t) => a + t.targetArea, 0) / pubW,
      pubCells: strict ? cells[l].pub : cells[l].pubR, privCells: strict ? cells[l].priv : cells[l].privR,
    };
  });
  const hosts = (h: number) => per.every(p =>
    (p.pubCells.length === 0 || bandCanHost(pubW, h - p.kitchenH, p.pubCells))
    && (p.privCells.length === 0 || bandCanHost(privW, h - p.southH, p.privCells)));
  const start = Math.ceil(Math.max(...per.map(p => p.need + p.kitchenH)) * 100 - 1e-6) / 100;
  return { start, hosts, per };
}

describe('P10 — BuildingFrameInput.verticalTargetLength (pure)', () => {
  const one = specsOf('rect14/b1/42');
  const two = specsOf('rect14/b2/42');

  it('false ≡ omitted: the uncut vertical frame is carveZones\' whole slice, no residual', () => {
    const f = frameOf(one)!;
    expect(f.spine).toBe('vertical');
    expect(f.local.frame).toEqual(SLICE);
    expect(f.local.residualRear).toBeNull();
    expect(strip(frameOf(one, false))).toBe(strip(f));
  });

  it('target length: starts at Σ public / semi-private targetArea ÷ band width + kitchen pocket (cm-rounded up)', () => {
    const full = frameOf(one)!;
    const cut = frameOf(one, true)!;
    const { start, per } = lengthRule(full, one);
    expect(per[0].need).toBeGreaterThan(0);
    expect(per[0].kitchenH).toBeCloseTo(full.local.kitchenStrip!.h, 9);
    expect(cut.local.frame.h).toBeGreaterThanOrEqual(start - 1e-9);
    expect(cut.local.frame.h).toBeLessThan(SLICE.h);
  });

  it('1 cm search: the cut is the FIRST length ≥ the target length at which bandCanHost holds on every floor', () => {
    for (const floorSpecs of [one, two]) {
      const full = frameOf(floorSpecs)!;
      const cut = frameOf(floorSpecs, true)!;
      const { start, hosts } = lengthRule(full, floorSpecs);
      const h = cut.local.frame.h;
      expect(Math.round(h * 100)).toBe(h * 100); // a cm step
      expect(hosts(h)).toBe(true);
      for (let t = start; t < h - 1e-9; t = Math.round(t * 100 + 1) / 100) expect(hosts(t), `length ${t}`).toBe(false);
    }
    // the two-floor search holds for BOTH floors (never shorter than either floor alone)
    const hTwo = frameOf(two, true)!.local.frame.h;
    for (const fl of two) {
      const single = frameOf([fl], true);
      if (single) expect(hTwo).toBeGreaterThanOrEqual(single.local.frame.h - 1e-9);
    }
  });

  it('cut geometry: bands end at the cut, rear residual = the rest of the slice, spine and widths unchanged', () => {
    const full = frameOf(one)!;
    const cut = frameOf(one, true)!;
    const h = cut.local.frame.h;
    expect(cut.local.frame).toEqual({ ...SLICE, h });
    for (const k of ['publicBand', 'corridor', 'privateBand'] as const) {
      expect(cut.local[k].x).toBe(full.local[k].x);
      expect(cut.local[k].w).toBe(full.local[k].w);
      expect(cut.local[k].y).toBe(SLICE.y);
      expect(cut.local[k].h).toBe(h);
    }
    expect(cut.corridorFraction).toBe(full.corridorFraction);
    expect(cut.local.residualRear).toEqual({ x: SLICE.x, y: SLICE.y + h, w: SLICE.w, h: SLICE.h - h });
    expect(cut.local.residualSide).toBeNull();
    // kitchen strip: same size, moved to the new rear end
    const k0 = full.local.kitchenStrip!, k1 = cut.local.kitchenStrip!;
    expect([k1.x, k1.w, k1.h]).toEqual([k0.x, k0.w, k0.h]);
    expect(k1.y + k1.h).toBeCloseTo(SLICE.y + h, 9);
  });

  it('zones: stair / lift / storage pockets exactly carveZones\'; the kitchen pocket keeps its size, moved; zones end at the cut', () => {
    for (const floorSpecs of [one, two]) {
      const full = frameOf(floorSpecs)!;
      const cut = frameOf(floorSpecs, true)!;
      const top = SLICE.y + cut.local.frame.h;
      for (const specs of floorSpecs) {
        const a = verticalFloorZones(full, specs), b = verticalFloorZones(cut, specs);
        expect(b.stairPocket).toEqual(a.stairPocket);
        expect(b.elevatorPocket).toEqual(a.elevatorPocket);
        const nonKitchen = (z: typeof a) => z.zones.service.filter(r => !a.kitchenPocket || r.x !== a.kitchenPocket.x || r.w !== a.kitchenPocket.w || r.h !== a.kitchenPocket.h);
        expect(nonKitchen(b)).toEqual(nonKitchen(a)); // storage / stair pockets
        if (a.kitchenPocket) {
          const kb = b.kitchenPocket!;
          expect([kb.x, kb.w, kb.h]).toEqual([a.kitchenPocket.x, a.kitchenPocket.w, a.kitchenPocket.h]);
          expect(kb.y + kb.h).toBeCloseTo(top, 9);
          expect(b.zones.service).toContainEqual(kb); // still the designated service pocket
          expect(b.zones.public[0].y + b.zones.public[0].h).toBeCloseTo(kb.y, 9);
        } else {
          expect(b.zones.public[0].y + b.zones.public[0].h).toBeCloseTo(top, 9);
        }
        expect(b.corridors[0].y + b.corridors[0].h).toBeCloseTo(top, 9);
        expect(b.zones.private[0].y).toBe(a.zones.private[0].y);
        expect(b.zones.private[0].y + b.zones.private[0].h).toBeCloseTo(top, 9);
        // nothing of the partition enters the rear residual
        const res = cut.world.residualRear!;
        for (const r of [...b.corridors, ...Object.values(b.zones).flat()]) expect(overlapArea(r, res)).toBe(0);
      }
    }
  });

  it('no cut → null (the retry is then not attempted)', () => {
    // a slice already at (or under) the target length has nothing to cut
    const short = deriveBuildingFrame({ slice: { ...SLICE, h: 12 }, access: 'south', strategy: DAY, floorSpecs: one, verticalSpine: true, verticalTargetLength: true });
    expect(short).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------------------

describe('P10 — G11 rejection → one vertical target-length retry', () => {
  it('P4 single floor: every attempt rejected → ONE cut rebuild, after all other attempts → adopted', () => {
    const v = on('rect14/b1/42', [DAY])[0];
    const vc = calls.findIndex(c => c.vertical);
    expect(verticalCalls()).toHaveLength(1);
    expect(verticalCalls()[0].fn).toBe('place');
    expect(vc).toBe(calls.length - 1); // after P4 / P8 / P9
    expect(calls.slice(0, vc).length).toBeGreaterThanOrEqual(2); // both families tried first
    expect(isVertical(v)).toBe(true);
    expectSafeVertical(v, off('rect14/b1/42', [DAY])[0]);
  });

  it('P5 multi-floor: the core is re-planned ONCE on the cut frame; stair / elevator geometry unchanged', () => {
    for (const id of ['rect14/b2/42', 'rect14/b3lift/42']) {
      calls.length = 0;
      const v = on(id, [DAY])[0];
      expect(v.floors.length).toBeGreaterThan(1);
      expect(verticalCalls().filter(c => c.fn === 'plan')).toHaveLength(1);
      expect(calls.findIndex(c => c.vertical)).toBe(calls.length - 1);
      const base = off(id, [DAY])[0];
      expect(verticalGeometry(v)).toEqual(verticalGeometry(base));
      expectSafeVertical(v, base);
    }
  });

  it('a retry that fails the P6 / guard checks → the exact legacy candidate', () => {
    for (const id of ['R12x22--S0-1bd-open', 'R12x26--S2-3bd']) {
      calls.length = 0;
      const c = on(id, [DAY])[0];
      expect(verticalCalls()).toHaveLength(1);
      expect(isAdopted(c)).toBe(false);
      expect(isVertical(c)).toBe(false);
      expect(strip(c)).toBe(strip(off(id, [DAY])[0]));
    }
  });

  it('never on horizontal / L-spur strategies, and never after an earlier adoption (P8 / P9 unchanged)', () => {
    // P9 adoption (functional-circulation) and P8 adoption: no vertical rebuild, notes intact
    const p9 = on('rect14/b1/42', ['functional-circulation'])[0];
    expect(p9.explanations.some(e => e.startsWith(COORDINATED_TARGET_RETRY))).toBe(true);
    expect(isVertical(p9)).toBe(false);
    const p8 = on('R16x26--S2-3bd', ['functional-circulation'])[0];
    expect(p8.explanations.some(e => e.startsWith(COORDINATED_RESIDUAL_RETRY))).toBe(true);
    expect(isVertical(p8)).toBe(false);
    for (const st of ['area-efficiency', 'alternative-zoning'] as CandidateStrategy[]) on('rect14/b1/42', [st]);
    expect(verticalCalls()).toHaveLength(0);
    // a first-attempt adoption ends the attempts before the retry
    calls.length = 0;
    const a = on('rect/b1/42', ['functional-circulation'])[0];
    expect(isAdopted(a)).toBe(true);
    expect(verticalCalls()).toHaveLength(0);
  });
});

describe('P10 — vertical-retry safety on every adopted benchmark / sweep case', () => {
  const CASES = [
    'rect14/b1/42', 'rect14/b1/7', 'rect14/b2/42', 'rect14/b2/7', 'rect14/b3lift/42', 'rect14/b3lift/7',
    'R12x26--S0-1bd-open', 'R12x26--S1-2bd', 'R12x26--S4-3bd2mb', 'R12x30--S0-1bd-open', 'R12x30--S1-2bd', 'R12x30--S2-3bd',
    'R12x30--S4-3bd2mb', 'R12x34--S0-1bd-open', 'R12x34--S1-2bd', 'R12x34--S2-3bd', 'R12x34--S4-3bd2mb',
    'R14x18--S0-1bd-open', 'R14x18--S1-2bd', 'R14x22--S0-1bd-open', 'R14x22--S1-2bd', 'R14x22--S2-3bd',
    'R14x26--S0-1bd-open', 'R14x26--S1-2bd', 'R14x26--S2-3bd', 'R14x26--S4-3bd2mb', 'R14x26--U0-2f3bd', 'R14x26--U1-2f4bd', 'R14x26--U2-3f5bd',
    'R14x30--S0-1bd-open', 'R14x30--S1-2bd', 'R14x30--S2-3bd', 'R14x30--S4-3bd2mb', 'R14x30--U0-2f3bd', 'R14x30--U1-2f4bd', 'R14x30--U2-3f5bd',
    'R14x34--S0-1bd-open', 'R14x34--S1-2bd', 'R14x34--S2-3bd', 'R14x34--S4-3bd2mb', 'R14x34--U0-2f3bd', 'R14x34--U1-2f4bd', 'R14x34--U2-3f5bd',
    'R16x18--S0-1bd-open', 'R16x18--S1-2bd', 'R16x22--S0-1bd-open', 'R16x22--S1-2bd', 'R16x22--S2-3bd', 'R16x22--U0-2f3bd', 'R16x22--U2-3f5bd',
    'R16x26--S0-1bd-open', 'R16x26--S1-2bd', 'R16x26--S2-3bd', 'R16x26--S3-4bd', 'R16x26--S4-3bd2mb',
    'R16x30--S0-1bd-open', 'R16x30--S1-2bd', 'R16x30--S3-4bd', 'R16x34--S0-1bd-open', 'R16x34--S1-2bd', 'R16x34--S3-4bd',
  ];
  it.each(CASES)('%s: HARD, circulation/access/daylight, programme, core, rooms ≤ 60, residual, other strategies untouched', (id) => {
    const cs = on(id);
    const bs = off(id);
    expectSafeVertical(byStrategy(cs, DAY), byStrategy(bs, DAY));
    for (const st of S) {
      const v = byStrategy(cs, st);
      if (st !== DAY) expect(isVertical(v)).toBe(false);
      if (!isAdopted(v)) expect(strip(v)).toBe(strip(byStrategy(bs, st))); // exact legacy fallback
    }
  });

  it('deterministic: repeated generation is byte-identical', () => {
    for (const id of ['rect14/b1/42', 'rect14/b2/42', 'R16x34--S0-1bd-open', 'R12x22--S0-1bd-open']) expect(strip(on(id))).toBe(strip(on(id)));
  });
});

describe('P10 — option off / omitted', () => {
  it('never reaches the coordinated planner or its retries; false ≡ omitted', () => {
    for (const id of ['rect14/b1/42', 'rect14/b2/42']) {
      const omitted = off(id);
      expect(calls).toHaveLength(0);
      const f = generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false });
      expect(calls).toHaveLength(0);
      expect(strip(f)).toBe(strip(omitted));
      expect(omitted.every(c => !isVertical(c) && !isAdopted(c))).toBe(true);
    }
  });
});
