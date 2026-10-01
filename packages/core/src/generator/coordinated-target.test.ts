/**
 * P9 — the coordinated planner's bounded target-depth retry. Runs when a P4 / P5 attempt
 * is rejected by the unchanged adoption guard and that guard's G10 comparison shows worse
 * living / dining target deviation than legacy. The two families are then rebuilt once
 * with target-sized public / private band depths (BuildingFrameInput.targetPublicDepth):
 * target area ÷ row share in row mode, target area ÷ band width per stacked cell. For
 * multi-floor P5 the core is re-planned once through planCoordinatedCore. The retry runs
 * after P8's residual retry and goes through the same P6 checks and unchanged guard. A
 * retry that fails falls back to the exact legacy candidate. Opt-in only
 * (coordinatedRectPlanner). Cases are the existing benchmark / sweep inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { fn: 'place' | 'plan'; noSideResidual: boolean; targetPublicDepth: boolean };
const calls = vi.hoisted(() => [] as Call[]);
vi.mock('../layout/coordinated-rect.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layout/coordinated-rect.js')>();
  return {
    ...actual,
    placeCoordinatedRect: (...a: Parameters<typeof actual.placeCoordinatedRect>) => {
      calls.push({ fn: 'place', noSideResidual: a[0].noSideResidual === true, targetPublicDepth: a[0].targetPublicDepth === true });
      return actual.placeCoordinatedRect(...a);
    },
    planCoordinatedCore: (...a: Parameters<typeof actual.planCoordinatedCore>) => {
      calls.push({ fn: 'plan', noSideResidual: a[0].noSideResidual === true, targetPublicDepth: a[0].targetPublicDepth === true });
      return actual.planCoordinatedCore(...a);
    },
  };
});

import { generateLayouts } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import {
  COORDINATED_RESIDUAL_APPLIED, COORDINATED_RESIDUAL_RETRY, COORDINATED_TARGET_RETRY,
} from '../layout/coordinated-rect.js';
import { bandDepthDemand, deriveBuildingFrame, type RoomTargets } from '../layout/building-frame.js';
import { floorWallPad } from '../layout/compaction.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy, Floor } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Rect } from '../geometry/rect.js';

const S: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const ALL = [...benchmarkInputs(), ...sweepInputs()];
const inputOf = (id: string): ProjectInput => structuredClone(ALL.find(b => b.id === id)!.input);
const strip = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'generatedAt' ? undefined : v));
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const off = (id: string, st: CandidateStrategy[] = S) => generateLayouts(inputOf(id), st, { upperFloorFrontPrivate: true });
const on = (id: string, st: CandidateStrategy[] = S) =>
  generateLayouts(inputOf(id), st, { upperFloorFrontPrivate: true, coordinatedRectPlanner: true });
const isAdopted = (c: LayoutCandidate) => c.explanations.some(e => /^P[45]: coordinated .* adopted/.test(e));
const isTarget = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(COORDINATED_TARGET_RETRY));
const isResidualRetry = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(COORDINATED_RESIDUAL_RETRY));
const targetCalls = () => calls.filter(c => c.targetPublicDepth);

const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').length;
const count = (c: LayoutCandidate, re: RegExp) => c.findings.filter(f => re.test(f.code)).length;
const CIRC = /CIRC/;
const ACCESS = /ACCESS|REACH|INACCESS/;
const DAYLIGHT = /DAYLIGHT|DYL/;
const CIRCULATION_TYPES = new Set(['corridor', 'stair-hall', 'entrance', 'foyer', 'elevator-hall']);
const programme = (c: LayoutCandidate) => c.floors.map(f =>
  f.spaces.filter(s => !CIRCULATION_TYPES.has(s.type)).map(s => s.type).sort().join(','));
const verticalGeometry = (c: LayoutCandidate) => c.floors.map(f => ({
  stairs: f.stairs.map(s => [s.footprint.w.toFixed(3), s.footprint.h.toFixed(3), s.flights.length, s.totalRisers, s.treadDepth]),
  elevators: f.elevators.map(e => [e.rect.w.toFixed(3), e.rect.h.toFixed(3)]),
}));
const maxRoom = (c: LayoutCandidate) =>
  Math.max(...c.floors.flatMap(f => f.spaces.filter(s => s.type !== 'corridor').map(s => s.area ?? s.rect.w * s.rect.h)));
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
 * Independent residual check. Every floor must carry its P6 note. For south access the strips
 * are placed from the note's dimensions and the buildable rect: rear strip on the buildable's
 * rear (max-y) edge, side strip on its east edge in front of the rear strip. For east access,
 * the rear strip goes on the buildable's west (min-x) edge. No room / core / parking rect may
 * enter a strip beyond the exterior-wall pad.
 */
function expectResidualOpen(c: LayoutCandidate, access: string) {
  const E = 0.011; // the note prints centimetres
  const b = c.buildableArea as Rect;
  for (const f of c.floors) {
    const note = c.explanations.find(e => e.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level ${f.level} `));
    expect(note, `level ${f.level} P6 note`).toBeDefined();
    const m = note!.match(/rear (none|([\d.]+)×([\d.]+) m), side (none|([\d.]+)×([\d.]+) m)/)!;
    const pad = floorWallPad(f);
    const strips: Rect[] = [];
    if (access === 'south') {
      const rearH = m[1] === 'none' ? 0 : Number(m[3]);
      if (m[1] !== 'none') strips.push({ x: b.x, y: b.y + b.h - rearH + pad, w: Number(m[2]), h: rearH - pad });
      if (m[4] !== 'none') {
        strips.push({ x: b.x + b.w - Number(m[5]) + pad, y: b.y + b.h - rearH - Number(m[6]), w: Number(m[5]) - pad, h: Number(m[6]) });
      }
    } else if (access === 'east' && m[1] !== 'none') {
      strips.push({ x: b.x, y: b.y, w: Number(m[2]) - pad, h: Number(m[3]) });
    }
    for (const r of strips) {
      const inner = { x: r.x + E, y: r.y + E, w: r.w - 2 * E, h: r.h - 2 * E };
      for (const o of occupied(f)) expect(overlapArea(o, inner), `level ${f.level} rect in the residual`).toBe(0);
    }
  }
}

/** The P9 acceptance properties of a target-retry-adopted candidate against its legacy candidate. */
function expectSafeTarget(v: LayoutCandidate, base: LayoutCandidate, access: string) {
  expect(isAdopted(v)).toBe(true);
  expect(hard(v)).toBeLessThanOrEqual(hard(base));
  if (base.valid) expect(v.valid).toBe(true);
  for (const re of [CIRC, ACCESS, DAYLIGHT]) expect(count(v, re), String(re)).toBeLessThanOrEqual(count(base, re));
  expect(programme(v)).toEqual(programme(base));
  expect(verticalGeometry(v)).toEqual(verticalGeometry(base));
  expect(maxRoom(v)).toBeLessThanOrEqual(60);
  expect((v.floors[0].parkingStalls ?? []).length).toBe((base.floors[0].parkingStalls ?? []).length);
  expectResidualOpen(v, access);
}

beforeEach(() => { calls.length = 0; });

describe('P9 — bandDepthDemand target-sized depths (pure)', () => {
  const T = (type: string, minW: number, minD: number, minA: number, target: number, maxDimension: number | null = null): RoomTargets => ({
    placedId: type, type, band: 'public', minWidth: minW, minDepth: minD, minArea: minA, targetArea: target, widthFloor: minW, maxDimension,
  });

  it('row mode: target area ÷ the row share (bounded as before), below the P16-C capped depth', () => {
    const row = [T('living', 3.6, 3.6, 20, 30)];
    const capped = bandDepthDemand(row, 6, 12)!;
    const target = bandDepthDemand(row, 6, 12, true)!;
    expect(target.mode).toBe('row');
    expect(capped.mode).toBe('row');
    expect(target.depth).toBe(5); // 30 m² ÷ 6 m share
    expect(target.depth).toBeLessThan(capped.depth);
    // contract bounds unchanged: never below the contract depth …
    expect(bandDepthDemand([T('living', 3.6, 3.6, 20, 30)], 10, 12, true)!.depth).toBe(3.6);
    // … and never above the extent.
    expect(bandDepthDemand(row, 6, 4, true)!.depth).toBeLessThanOrEqual(4);
  });

  it('stacked / column mode: every full-width cell at target area ÷ band width, summed', () => {
    const two = [T('living', 3.6, 3.6, 16, 28), T('dining', 3, 3, 10, 14, 4.2)];
    const cappedTwo = bandDepthDemand(two, 4, 14)!;
    const targetTwo = bandDepthDemand(two, 4, 14, true)!;
    expect(targetTwo.mode).toBe('column');
    expect(cappedTwo.mode).toBe('column');
    expect(targetTwo.depth).toBe(10.5); // 28/4 + 14/4
    expect(targetTwo.depth).toBeLessThan(cappedTwo.depth);
    const three = [T('living', 3.2, 3.2, 14, 24), T('dining', 2.8, 2.8, 9, 12, 4.2), T('kitchen', 2.4, 2.4, 7, 9)];
    expect(bandDepthDemand(three, 3.6, 14, true)).toEqual({ mode: 'column', depth: 12.5 }); // (24+12+9)/3.6
  });

  it('the demand mode never depends on the depth sizing; false ≡ omitted', () => {
    const cases: [RoomTargets[], number, number][] = [
      [[T('living', 3.6, 3.6, 20, 30), T('kitchen', 2.4, 2.4, 8, 12)], 9, 12],
      [[T('living', 3.6, 3.6, 16, 28), T('dining', 3, 3, 10, 14, 4.2)], 4, 14],
    ];
    for (const [ts, w, e] of cases) {
      expect(bandDepthDemand(ts, w, e, true)!.mode).toBe(bandDepthDemand(ts, w, e)!.mode);
      expect(bandDepthDemand(ts, w, e, false)).toEqual(bandDepthDemand(ts, w, e));
    }
  });
});

describe('P9 — BuildingFrameInput.targetPublicDepth', () => {
  const id = 'R16x26--S2-3bd';
  const specs = programForFloor(inputOf(id).building, 0, true, allocateBuildingProgram(inputOf(id).building, 1)[0])
    .map((s, k) => ({ ...s, placedId: `${s.type}-0-${k}`, placedLabel: s.type }) as PlacedSpec);
  const slice: Rect = { x: 2, y: 5.7, w: 12, h: 17.3 };
  const frameOf = (targetPublicDepth?: boolean) => deriveBuildingFrame({
    slice, access: 'south', strategy: 'functional-circulation', floorSpecs: [specs], verticalSpine: true,
    ...(targetPublicDepth === undefined ? {} : { targetPublicDepth }),
  })!;

  it('sizes the bands toward the targets (never deeper than the capped frame); false ≡ omitted', () => {
    const capped = frameOf();
    const target = frameOf(true);
    expect(target).not.toBeNull();
    expect(target.publicDepth).toBeLessThanOrEqual(capped.publicDepth);
    expect(target.publicDepth + target.privateDepth).toBeLessThanOrEqual(capped.publicDepth + capped.privateDepth);
    expect(strip(frameOf(false))).toBe(strip(capped));
  });
});

describe('P9 — G10 rejection → one target-depth retry', () => {
  it('P4 single floor: both families rejected with worse deviation → target retry → adopted through the unchanged guard', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const v = on('rect14/b1/42', [st])[0];
    const first = calls.filter(c => c.fn === 'place' && !c.targetPublicDepth && !c.noSideResidual);
    expect(first).toHaveLength(2); // both first-pass families rejected
    expect(calls.filter(c => c.noSideResidual)).toHaveLength(0); // no residual rejection: no P8 pass
    expect(targetCalls().length).toBeGreaterThanOrEqual(1);
    expect(targetCalls().length).toBeLessThanOrEqual(2); // one retry pass: at most once per family
    expect(calls.findIndex(c => c.targetPublicDepth)).toBeGreaterThan(calls.lastIndexOf(first[1]));
    expect(isTarget(v)).toBe(true);
    expect(isResidualRetry(v)).toBe(false);
    expectSafeTarget(v, off('rect14/b1/42', [st])[0], 'south');
  });

  it('P5 multi-floor: the core is re-planned once with target-sized depths → adopted, stair / elevator unchanged', () => {
    const st: CandidateStrategy = 'alternative-zoning';
    const v = on('rect14/b2/42', [st])[0];
    expect(v.floors.length).toBeGreaterThan(1);
    const plans = calls.filter(c => c.fn === 'plan');
    expect(plans.filter(c => c.targetPublicDepth)).toHaveLength(1);
    expect(plans.filter(c => !c.targetPublicDepth && !c.noSideResidual)).toHaveLength(1);
    // the re-planned core is the one handed to the retry's placements
    const firstTargetPlan = calls.findIndex(c => c.fn === 'plan' && c.targetPublicDepth);
    expect(calls.slice(firstTargetPlan + 1).every(c => c.targetPublicDepth)).toBe(true);
    expect(isTarget(v)).toBe(true);
    const base = off('rect14/b2/42', [st])[0];
    expect(verticalGeometry(v)).toEqual(verticalGeometry(base));
    expectSafeTarget(v, base, 'south');
  });

  it('P8 → P9 sequencing: the residual retry runs first; its rejection moves on to the target retry', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const v = on('rectE/b2/42', [st])[0];
    const lastResidual = calls.map(c => c.noSideResidual).lastIndexOf(true);
    const firstTarget = calls.findIndex(c => c.targetPublicDepth);
    expect(lastResidual).toBeGreaterThanOrEqual(0);
    expect(firstTarget).toBeGreaterThan(lastResidual);
    expect(calls.some(c => c.noSideResidual && c.targetPublicDepth)).toBe(false); // the retries never combine
    expect(isTarget(v)).toBe(true);
    expect(isResidualRetry(v)).toBe(false);
    expectSafeTarget(v, off('rectE/b2/42', [st])[0], 'east');
  });

  it('a target retry that fails the P6 / guard checks → the exact legacy candidate', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const c = on('rectE/b4/42', [st])[0];
    expect(targetCalls().length).toBeGreaterThanOrEqual(1);
    expect(isAdopted(c)).toBe(false);
    expect(isTarget(c)).toBe(false);
    expect(strip(c)).toBe(strip(off('rectE/b4/42', [st])[0]));
  });

  it('no target retry without a G10-worse rejection', () => {
    // first-attempt adoption
    const a = on('rect/b1/42', ['functional-circulation'])[0];
    expect(isAdopted(a)).toBe(true);
    expect(targetCalls()).toHaveLength(0);
    // rejected, but not with worse deviation → no retry → exact legacy
    calls.length = 0;
    const r = on('rect/b1/42', ['area-efficiency'])[0];
    expect(calls.length).toBeGreaterThan(0);
    expect(targetCalls()).toHaveLength(0);
    expect(strip(r)).toBe(strip(off('rect/b1/42', ['area-efficiency'])[0]));
  });

  it('P8 output unchanged: a residual-retry adoption ends the attempts before any target retry', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const v = on('R16x26--S2-3bd', [st])[0];
    expect(isResidualRetry(v)).toBe(true);
    expect(isTarget(v)).toBe(false);
    expect(targetCalls()).toHaveLength(0);
    calls.length = 0;
    const m = on('rect/b4/42', [st])[0];
    expect(isResidualRetry(m)).toBe(true);
    expect(targetCalls()).toHaveLength(0);
  });
});

describe('P9 — target-retry safety on every target-adopted benchmark / sweep case', () => {
  const CASES = [
    'rectE/b2/42', 'rectE/b2/7', 'rectE/b3lift/42', 'rectE/b3lift/7',
    'rect14/b1/42', 'rect14/b1/7', 'rect14/b2/42', 'rect14/b2/7', 'rect14/b3lift/42', 'rect14/b3lift/7',
    'rect14/b4/42', 'rect14/b4/7', 'R10x34--S0-1bd-open', 'R14x18--S1-2bd', 'R14x22--S0-1bd-open',
    'R14x22--S1-2bd', 'R14x22--U0-2f3bd', 'R14x22--U2-3f5bd', 'R14x26--S0-1bd-open', 'R14x26--S1-2bd',
    'R20x15--S0-1bd-open', 'R20x15--S1-2bd', 'R20x18--S2-3bd', 'R20x22--S2-3bd',
  ];
  it.each(CASES)('%s: HARD, circulation/access/daylight, programme, core, rooms ≤ 60, residual', (id) => {
    const access = inputOf(id).site.accessSide;
    const cs = on(id);
    const bs = off(id);
    let targets = 0;
    for (const st of S) {
      const v = byStrategy(cs, st);
      const base = byStrategy(bs, st);
      if (isTarget(v)) { targets++; expectSafeTarget(v, base, access); }
      else if (!isAdopted(v)) expect(strip(v)).toBe(strip(base)); // exact legacy fallback
    }
    expect(targets).toBeGreaterThan(0);
  });

  it('deterministic: repeated generation is byte-identical', () => {
    for (const id of ['rect14/b1/42', 'rect14/b2/42', 'rectE/b2/42', 'rectE/b4/42']) expect(strip(on(id))).toBe(strip(on(id)));
  });
});

describe('P9 — option off / omitted', () => {
  it('never reaches the coordinated planner or its retries; false ≡ omitted', () => {
    for (const id of ['rect14/b1/42', 'rect14/b2/42', 'rectE/b2/42']) {
      const omitted = off(id);
      expect(calls).toHaveLength(0);
      const f = generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false });
      expect(calls).toHaveLength(0);
      expect(strip(f)).toBe(strip(omitted));
      expect(omitted.every(c => !isTarget(c) && !isAdopted(c))).toBe(true);
    }
  });
});
