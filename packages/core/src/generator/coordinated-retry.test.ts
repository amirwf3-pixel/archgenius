/**
 * P8 — the coordinated planner's single bounded retry: when a P4 / P5 attempt is discarded
 * FIRST by the P6 residual-intrusion check, the two families are rebuilt once with the
 * frame's side residual strip disabled (BuildingFrameInput.noSideResidual — the existing
 * full-width frame path; the rear residual unchanged). The retry runs the normal P6 checks
 * and the unchanged adoption guard; a retry that fails falls back to the exact legacy
 * candidate. Opt-in only (coordinatedRectPlanner). Cases are the existing benchmark /
 * sweep inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => [] as { fn: 'place' | 'plan'; noSideResidual: boolean }[]);
vi.mock('../layout/coordinated-rect.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layout/coordinated-rect.js')>();
  return {
    ...actual,
    placeCoordinatedRect: (...a: Parameters<typeof actual.placeCoordinatedRect>) => {
      calls.push({ fn: 'place', noSideResidual: a[0].noSideResidual === true });
      return actual.placeCoordinatedRect(...a);
    },
    planCoordinatedCore: (...a: Parameters<typeof actual.planCoordinatedCore>) => {
      calls.push({ fn: 'plan', noSideResidual: a[0].noSideResidual === true });
      return actual.planCoordinatedCore(...a);
    },
  };
});

import { generateLayouts } from './generator.js';
import { benchmarkInputs, sweepInputs } from '../regression/layout-cases.js';
import { COORDINATED_RESIDUAL_APPLIED, COORDINATED_RESIDUAL_RETRY } from '../layout/coordinated-rect.js';
import { deriveBuildingFrame } from '../layout/building-frame.js';
import { floorWallPad } from '../layout/compaction.js';
import { allocateBuildingProgram, programForFloor } from '../programming/program.js';
import type { PlacedSpec } from '../layout/placer.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
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
const isRetry = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(COORDINATED_RESIDUAL_RETRY));
const retryCalls = () => calls.filter(c => c.noSideResidual);

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

/** Every P6 note of a retry candidate: no side strip; the rear strip (SOUTH access) stays open. */
function expectRetryResidualOpen(c: LayoutCandidate) {
  const notes = c.explanations.filter(e => e.startsWith(COORDINATED_RESIDUAL_APPLIED));
  expect(notes.length).toBe(c.floors.length);
  const b = c.buildableArea as Rect;
  for (const f of c.floors) {
    const note = notes.find(n => n.startsWith(`${COORDINATED_RESIDUAL_APPLIED} level ${f.level} `))!;
    const m = note.match(/rear (none|([\d.]+)×([\d.]+) m), side (none|[\d.×]+ m)/)!;
    expect(m[4], 'retry frames carry no side strip').toBe('none');
    if (m[1] === 'none') continue;
    const pad = floorWallPad(f);
    const rear: Rect = { x: b.x, y: b.y + b.h - Number(m[3]) + pad, w: Number(m[2]), h: Number(m[3]) - pad };
    const occupied: Rect[] = [
      ...f.spaces.filter(s => s.type !== 'yard').map(s => s.rect),
      ...f.stairs.map(s => s.footprint), ...f.elevators.map(e => e.rect),
      ...(f.parkingStalls ?? []).map(p => p.rect),
      ...(f.parkingArea?.aisleRect ? [f.parkingArea.aisleRect] : []),
    ];
    for (const r of occupied) expect(overlapArea(r, rear), `level ${f.level} rect in the rear residual`).toBe(0);
  }
}

/** The P8 acceptance properties of a retry-adopted candidate against its legacy candidate. */
function expectSafeRetry(v: LayoutCandidate, base: LayoutCandidate) {
  expect(isAdopted(v)).toBe(true);
  expect(hard(v)).toBeLessThanOrEqual(hard(base));
  if (base.valid) expect(v.valid).toBe(true);
  for (const re of [CIRC, ACCESS, DAYLIGHT]) expect(count(v, re), String(re)).toBeLessThanOrEqual(count(base, re));
  expect(programme(v)).toEqual(programme(base));
  expect(verticalGeometry(v)).toEqual(verticalGeometry(base));
  if (maxRoom(v) > 60) expect(maxRoom(v)).toBeLessThanOrEqual(maxRoom(base));
  expect((v.floors[0].parkingStalls ?? []).length).toBe((base.floors[0].parkingStalls ?? []).length);
  expectRetryResidualOpen(v);
}

beforeEach(() => { calls.length = 0; });

describe('P8 — BuildingFrameInput.noSideResidual (the existing full-width frame path)', () => {
  const id = 'R16x26--S2-3bd';
  const specs = programForFloor(inputOf(id).building, 0, true, allocateBuildingProgram(inputOf(id).building, 1)[0])
    .map((s, k) => ({ ...s, placedId: `${s.type}-0-${k}`, placedLabel: s.type }) as PlacedSpec);
  const slice: Rect = { x: 2, y: 5.7, w: 12, h: 17.3 };
  const frameOf = (noSideResidual?: boolean) => deriveBuildingFrame({
    slice, access: 'south', strategy: 'functional-circulation', floorSpecs: [specs], verticalSpine: true,
    ...(noSideResidual === undefined ? {} : { noSideResidual }),
  })!;

  it('disables only the side cut: full slice width, no side strip, rear strip and band depths unchanged', () => {
    const cut = frameOf();
    const full = frameOf(true);
    expect(cut.local.residualSide).not.toBeNull();
    expect(cut.local.frame.w).toBeLessThan(slice.w);
    expect(full.local.residualSide).toBeNull();
    expect(full.local.frame.w).toBeCloseTo(slice.w, 9);
    expect(full.local.residualRear).toEqual(cut.local.residualRear);
    expect(full.publicDepth).toBe(cut.publicDepth);
    expect(full.privateDepth).toBe(cut.privateDepth);
    expect(full.local.frame.h).toBe(cut.local.frame.h);
    // false / omitted are the unchanged P1–P7 frame.
    expect(strip(frameOf(false))).toBe(strip(cut));
  });
});

describe('P8 — residual rejection → one side-strip-free retry', () => {
  it('P4 single floor: residual rejection → retry → adopted through the unchanged guard', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const v = on('R16x26--S2-3bd', [st])[0];
    expect(calls.filter(c => c.fn === 'place' && !c.noSideResidual)).toHaveLength(2); // both families rejected
    expect(retryCalls().length).toBeGreaterThanOrEqual(1);
    expect(retryCalls().length).toBeLessThanOrEqual(2); // one retry pass: at most once per family
    expect(isRetry(v)).toBe(true);
    expectSafeRetry(v, off('R16x26--S2-3bd', [st])[0]);
  });

  it('P5 multi-floor: residual rejection → the core is re-planned once without the side strip → adopted', () => {
    const st: CandidateStrategy = 'functional-circulation';
    const v = on('rect/b4/42', [st])[0];
    expect(calls.filter(c => c.fn === 'plan' && c.noSideResidual)).toHaveLength(1);
    expect(isRetry(v)).toBe(true);
    expectSafeRetry(v, off('rect/b4/42', [st])[0]);
  });

  it('retry that fails the P6 / guard checks → the exact legacy candidate', () => {
    // parking in the residual is not a side-strip overflow: the retry is rejected again
    // (as is the later P9 target-depth retry, so the case falls back to legacy).
    const st: CandidateStrategy = 'functional-circulation';
    const c = on('rectE/b4/42', [st])[0];
    expect(retryCalls().length).toBeGreaterThanOrEqual(1);
    expect(isAdopted(c)).toBe(false);
    expect(isRetry(c)).toBe(false);
    expect(strip(c)).toBe(strip(off('rectE/b4/42', [st])[0]));
  });

  it('no retry without a residual-intrusion rejection (first-attempt adoption, no frame)', () => {
    const a = on('rect/b1/42', ['functional-circulation'])[0];
    expect(isAdopted(a)).toBe(true);
    expect(isRetry(a)).toBe(false);
    expect(retryCalls()).toHaveLength(0);
    calls.length = 0;
    on('R8x12--S0-1bd-open');
    expect(retryCalls()).toHaveLength(0);
  });
});

describe('P8 — retry safety on the retry-adopted benchmark / sweep cases', () => {
  const CASES = ['rect/b4/7', 'R16x30--S2-3bd', 'R20x26--S4-3bd2mb', 'R20x30--U2-3f5bd', 'R25x22--S3-4bd', 'R20x34--U0-2f3bd'];
  it.each(CASES)('%s: retry variants keep HARD, circulation/access/daylight, programme, core, rooms ≤ 60, residual', (id) => {
    const cs = on(id);
    const bs = off(id);
    let retries = 0;
    for (const st of S) {
      const v = byStrategy(cs, st);
      const base = byStrategy(bs, st);
      if (isRetry(v)) { retries++; expectSafeRetry(v, base); }
      else if (!isAdopted(v)) expect(strip(v)).toBe(strip(base)); // exact legacy fallback
    }
    expect(retries).toBeGreaterThan(0);
  });

  it('deterministic: repeated generation is byte-identical', () => {
    for (const id of ['R16x26--S2-3bd', 'rect/b4/42', 'rectE/b4/42']) expect(strip(on(id))).toBe(strip(on(id)));
  });
});

describe('P8 — option off / omitted', () => {
  it('never reaches the coordinated planner or its retry; false ≡ omitted', () => {
    for (const id of ['R16x26--S2-3bd', 'rect/b4/42', 'rectE/b2/42']) {
      const omitted = off(id);
      expect(calls).toHaveLength(0);
      const f = generateLayouts(inputOf(id), S, { upperFloorFrontPrivate: true, coordinatedRectPlanner: false });
      expect(calls).toHaveLength(0);
      expect(strip(f)).toBe(strip(omitted));
      expect(omitted.every(c => !isRetry(c) && !isAdopted(c))).toBe(true);
    }
  });
});
