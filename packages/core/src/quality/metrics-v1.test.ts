/**
 * Phase 5.1b-1 — Quality Metrics V1: residual area, parking, programme adjacency,
 * circulation. Every formula is exercised on a hand-built fixture whose expected
 * value is derivable by hand (shown in comments), including null / empty cases,
 * followed by domain-model findings and deterministic regression on generated layouts.
 */
import { describe, it, expect } from 'vitest';
import type { Floor } from '../model/floor.js';
import type { Rect } from '../geometry/rect.js';
import type { ProjectInput } from '../model/project.js';
import type { AdjacencyRequirement, SpaceType } from '../model/space.js';
import { createProject, generate } from '../pipeline.js';
import {
  computeResidualMetrics, computeParkingMetrics, computeAdjacencyMetrics, computeCirculationMetrics,
  computeQualityMetricsV1, programAdjacencyByType, metricRatio, rectsTouch, rectUnionArea,
  programSpecCountByType,
  type AdjacencyRequirementsByType, type ProgramSpecCountByType,
} from './metrics-v1.js';

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

type Sp = { id: string; type: string; x: number; y: number; w: number; h: number; minWidth?: number; adj?: string[]; polygon?: Array<{ x: number; y: number }> };
type Wl = { id: string; a: string | null; b: string | null; x0?: number; y0?: number; x1?: number; y1?: number; t?: number };
type Op = { id: string; wall: string; type?: 'door' | 'entrance' | 'sliding-door' | 'window'; cx: number; cy: number };

function floor(opts: {
  level?: number; fp?: Rect; spaces?: Sp[]; walls?: Wl[]; openings?: Op[];
  boundary?: Array<{ x: number; y: number }>; site?: Array<{ x: number; y: number }>;
  stalls?: Rect[]; aisle?: Rect; requested?: number; accessSide?: 'north' | 'south' | 'east' | 'west';
}): Floor {
  const f: Record<string, unknown> = {
    level: opts.level ?? 0,
    footprint: opts.fp ?? { x: 0, y: 0, w: 10, h: 10 },
    spaces: (opts.spaces ?? []).map(s => ({
      id: s.id, type: s.type, label: s.id, privacy: 'public', zone: 'public',
      rect: { x: s.x, y: s.y, w: s.w, h: s.h },
      polygon: s.polygon ?? [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }],
      area: s.w * s.h, targetArea: s.w * s.h, minArea: 0, minWidth: s.minWidth,
      wallIds: [], openingIds: [], adjacentSpaceIds: s.adj ?? [], hasExteriorWall: false, floor: opts.level ?? 0,
    })),
    walls: (opts.walls ?? []).map(w => ({
      id: w.id, kind: 'interior', thickness: w.t ?? 0,
      start: { x: w.x0 ?? 0, y: w.y0 ?? 0 }, end: { x: w.x1 ?? 0, y: w.y1 ?? 0 },
      spaceIds: [w.a, w.b], openingIds: [], floor: opts.level ?? 0,
    })),
    openings: (opts.openings ?? []).map(o => ({
      id: o.id, type: o.type ?? 'door', wallId: o.wall, center: { x: o.cx, y: o.cy },
      wallDir: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, width: 0.9, height: 2.1, sill: 0, floor: opts.level ?? 0,
    })),
    stairs: [], elevators: [], furniture: [],
    parkingStalls: (opts.stalls ?? []).map((r, i) => ({ id: `p${i}`, rect: r, index: i, covered: false, floor: 0 })),
    parkingArea: opts.aisle ? { aisleRect: opts.aisle, arrangement: 'parallel' } : undefined,
    parkingRequested: opts.requested,
    accessSide: opts.accessSide,
  };
  if (opts.boundary) f.buildableBoundary = opts.boundary;
  if (opts.site) f.siteBoundary = opts.site;
  return f as unknown as Floor;
}

const req = (spaceType: SpaceType | undefined, weight: number, doorRequired = false, adjacent = true): AdjacencyRequirement =>
  ({ spaceType, adjacent, weight, doorRequired });

// ---------------------------------------------------------------------------
// MetricValue
// ---------------------------------------------------------------------------

describe('metricRatio', () => {
  it('value = num/den, null when den <= 0 (not applicable, never a vacuous 1)', () => {
    expect(metricRatio(3, 4, 'GEOMETRIC')).toEqual({ value: 0.75, num: 3, den: 4, basis: 'GEOMETRIC' });
    expect(metricRatio(0, 0, 'PROGRAM').value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 1. Residual area
// ---------------------------------------------------------------------------

describe('residual: envelope, coverage, fragments', () => {
  it('fully covered footprint → residual 0, coverage 1, no fragments', () => {
    const r = computeResidualMetrics(floor({ spaces: [{ id: 'a', type: 'living', x: 0, y: 0, w: 10, h: 10 }] }));
    expect(r.envelopeSource).toBe('footprint-rect');
    expect(r.envelopeArea).toBeCloseTo(100, 9);
    expect(r.residualArea).toBeCloseTo(0, 9);
    expect(r.coverage.value).toBeCloseTo(1, 9);
    expect(r.fragmentCount).toBe(0);
    expect(r.largestFragmentArea).toBeNull();
  });

  it('one 4×6 hole: residual 24, coverage 76/100, fragment bbox (6,4,4,6)', () => {
    const r = computeResidualMetrics(floor({ spaces: [
      { id: 'a', type: 'living', x: 0, y: 0, w: 6, h: 10, minWidth: 2.5 },
      { id: 'b', type: 'storage', x: 6, y: 0, w: 4, h: 4, minWidth: 1.0 },
    ] }));
    expect(r.residualArea).toBeCloseTo(24, 9);
    expect(r.coverage.num).toBeCloseTo(76, 9);
    expect(r.coverage.den).toBeCloseTo(100, 9);
    expect(r.fragments).toHaveLength(1);
    expect(r.fragments[0].bbox).toEqual({ x: 6, y: 4, w: 4, h: 6 });
    expect(r.fragments[0].minSide).toBeCloseTo(4, 9);
    expect(r.usableWidthThreshold).toBe(1.0); // min programme minWidth on the floor
    expect(r.fragments[0].fitsUsableSquare).toBe(true);
    expect(r.unusableArea).toBe(0);
  });

  it('0.5 m sliver with threshold 1.0 → unusable 5 m²', () => {
    const r = computeResidualMetrics(floor({ spaces: [{ id: 'a', type: 'living', x: 0, y: 0, w: 9.5, h: 10, minWidth: 1 }] }));
    expect(r.residualArea).toBeCloseTo(5, 9);
    expect(r.fragments[0].fitsUsableSquare).toBe(false);
    expect(r.unusableArea).toBeCloseTo(5, 9);
    expect(r.unusableFragmentCount).toBe(1);
  });

  it('two equal fragments are separate components, ordered by area then y then x', () => {
    const r = computeResidualMetrics(floor({ fp: { x: 0, y: 0, w: 10, h: 4 }, spaces: [{ id: 'a', type: 'living', x: 3, y: 0, w: 4, h: 4, minWidth: 1 }] }));
    expect(r.fragmentCount).toBe(2);
    expect(r.fragments.map(f => f.bbox.x)).toEqual([0, 7]);
    expect(r.fragments.map(f => f.area)).toEqual([12, 12]);
    expect(r.largestFragmentArea).toBe(12);
  });

  it('uses the real L-shaped buildable polygon, not the bounding rect (84 vs 100 m²)', () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 }];
    const spaces: Sp[] = [{ id: 'a', type: 'living', x: 0, y: 0, w: 10, h: 6 }, { id: 'b', type: 'bedroom', x: 0, y: 6, w: 6, h: 4 }];
    const real = computeResidualMetrics(floor({ spaces, boundary: L }));
    expect(real.envelopeSource).toBe('buildableBoundary∩footprint');
    expect(real.envelopeArea).toBeCloseTo(84, 9);
    expect(real.footprintRectArea).toBeCloseTo(100, 9);
    expect(real.residualArea).toBeCloseTo(0, 9);
    expect(real.coverage.value).toBeCloseTo(1, 9);
    // the same floor judged against the bounding rect would misreport the 4×4 notch as leftover
    expect(computeResidualMetrics(floor({ spaces })).residualArea).toBeCloseTo(16, 9);
  });

  it('envelope is buildableBoundary ∩ footprint (footprint smaller than the polygon)', () => {
    const r = computeResidualMetrics(floor({
      fp: { x: 0, y: 0, w: 5, h: 5 }, boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
      spaces: [{ id: 'a', type: 'living', x: 0, y: 0, w: 5, h: 3 }],
    }));
    expect(r.envelopeArea).toBeCloseTo(25, 9);
    expect(r.residualArea).toBeCloseTo(10, 9);
  });

  it('wall bodies (centreline ± t/2 with end caps) fill the compaction pad band', () => {
    // centreline-cell room 10×10, exterior walls t=0.4 on its edges, footprint padded by 0.2
    const walls: Wl[] = [
      { id: 's', a: 'a', b: null, x0: 0, y0: 0, x1: 10, y1: 0, t: 0.4 },
      { id: 'n', a: 'a', b: null, x0: 0, y0: 10, x1: 10, y1: 10, t: 0.4 },
      { id: 'w', a: 'a', b: null, x0: 0, y0: 0, x1: 0, y1: 10, t: 0.4 },
      { id: 'e', a: 'a', b: null, x0: 10, y0: 0, x1: 10, y1: 10, t: 0.4 },
    ];
    const fp = { x: -0.2, y: -0.2, w: 10.4, h: 10.4 };
    const spaces: Sp[] = [{ id: 'a', type: 'living', x: 0, y: 0, w: 10, h: 10, minWidth: 1 }];
    const withWalls = computeResidualMetrics(floor({ fp, spaces, walls }));
    expect(withWalls.residualArea).toBeCloseTo(0, 9);
    expect(withWalls.fragmentCount).toBe(0);
    // without walls the 0.2 m ring remains: 10.4² − 10² = 8.16 m², one ring-shaped component
    const bare = computeResidualMetrics(floor({ fp, spaces }));
    expect(bare.residualArea).toBeCloseTo(8.16, 9);
    expect(bare.fragmentCount).toBe(1);
    // its bbox short side is 10.4 m, yet no 1 m square fits → unusable (bbox alone would be wrong)
    expect(bare.fragments[0].minSide).toBeCloseTo(10.4, 9);
    expect(bare.fragments[0].fitsUsableSquare).toBe(false);
    expect(bare.unusableArea).toBeCloseTo(8.16, 9);
  });

  it('L-shaped fragment: fits a t-square only where an arm is at least t wide', () => {
    // residual = 10×10 minus a 9×9 block at the origin → L with 1 m arms (19 m²)
    const f = (t: number) => computeResidualMetrics(floor({ spaces: [{ id: 'a', type: 'living', x: 0, y: 0, w: 9, h: 9, minWidth: t }] }));
    expect(f(1).residualArea).toBeCloseTo(19, 9);
    expect(f(1).fragments[0].fitsUsableSquare).toBe(true);
    expect(f(1.01).fragments[0].fitsUsableSquare).toBe(false);
  });

  it('stalls and aisle count as occupied', () => {
    const r = computeResidualMetrics(floor({
      spaces: [{ id: 'a', type: 'living', x: 0, y: 5, w: 10, h: 5 }],
      stalls: [{ x: 0, y: 3, w: 5, h: 2 }], aisle: { x: 0, y: 0, w: 5, h: 3 },
    }));
    expect(r.residualArea).toBeCloseTo(25, 9);
    expect(r.fragments[0].bbox).toEqual({ x: 5, y: 0, w: 5, h: 5 });
  });

  it('non-rectangular (L-polygon) space is rasterised by its polygon, not its bbox', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 }];
    const r = computeResidualMetrics(floor({ spaces: [{ id: 'a', type: 'living', x: 0, y: 0, w: 10, h: 10, polygon: poly }] }));
    expect(r.residualArea).toBeCloseTo(16, 9);
  });

  it('null cases: degenerate footprint → coverage null; no minWidth → threshold/unusable null', () => {
    const d = computeResidualMetrics(floor({ fp: { x: 0, y: 0, w: 0, h: 10 } }));
    expect(d.envelopeArea).toBe(0);
    expect(d.coverage.value).toBeNull();
    expect(d.usableWidthThreshold).toBeNull();
    expect(d.unusableArea).toBeNull();
    const e = computeResidualMetrics(floor({ spaces: [] }));
    expect(e.residualArea).toBeCloseTo(100, 9);
    expect(e.coverage.value).toBeCloseTo(0, 9);
    expect(e.fragments[0].fitsUsableSquare).toBeNull();
    expect(e.unusableFragmentCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Parking
// ---------------------------------------------------------------------------

describe('parking: fulfilment, aisle access, street access, stall share', () => {
  const aisle = { x: 0, y: 0, w: 6, h: 3.5 };
  const touching = { x: 0, y: 3.5, w: 2.5, h: 5 };  // shares edge y=3.5 with the aisle
  const detached = { x: 4, y: 5, w: 2, h: 2 };      // 1.5 m gap above the aisle
  const site = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }]; // CCW

  it('hand values: fulfilment 2/2, aisleAccess 1/2, stallAreaShare 16.5/37.5, street access south', () => {
    const p = computeParkingMetrics(floor({ stalls: [touching, detached], aisle, requested: 2, site, accessSide: 'south' }))!;
    expect(p.requested).toBe(2);
    expect(p.placed).toBe(2);
    expect(p.fulfilment).toMatchObject({ value: 1, num: 2, den: 2, basis: 'PROGRAM' });
    expect(p.aisleAccess).toMatchObject({ value: 0.5, num: 1, den: 2 });
    // stalls 12.5 + 4 = 16.5; union with aisle 21 → 37.5
    expect(p.stallAreaShare.num).toBeCloseTo(16.5, 9);
    expect(p.stallAreaShare.den).toBeCloseTo(37.5, 9);
    expect(p.stallAreaShare.value).toBeCloseTo(0.44, 9);
    expect(p.streetAccess).toBe(true);
  });

  it('fulfilment is min(placed, requested)/requested', () => {
    expect(computeParkingMetrics(floor({ stalls: [touching, detached], aisle, requested: 3 }))!.fulfilment.value).toBeCloseTo(2 / 3, 12);
    const over = computeParkingMetrics(floor({ stalls: [touching, detached, { x: 10, y: 10, w: 2, h: 5 }], aisle, requested: 2 }))!;
    expect(over.fulfilment).toMatchObject({ value: 1, num: 2, den: 2 });
    expect(computeParkingMetrics(floor({ stalls: [], aisle, requested: 2 }))!.fulfilment.value).toBe(0);
  });

  it('street access respects side, polygon winding and edge collinearity', () => {
    const cw = [...site].reverse();
    expect(computeParkingMetrics(floor({ stalls: [touching], aisle, site: cw, accessSide: 'south' }))!.streetAccess).toBe(true);
    expect(computeParkingMetrics(floor({ stalls: [touching], aisle, site, accessSide: 'north' }))!.streetAccess).toBe(false);
    const inset = { ...aisle, y: 1 };
    expect(computeParkingMetrics(floor({ stalls: [touching], aisle: inset, site, accessSide: 'south' }))!.streetAccess).toBe(false);
    expect(computeParkingMetrics(floor({ stalls: [touching], aisle, accessSide: 'south' }))!.streetAccess).toBeNull(); // no site polygon
  });

  it('null cases: nothing parking-related → null; no aisle → aisle metrics null; no request → fulfilment null', () => {
    expect(computeParkingMetrics(floor({}))).toBeNull();
    const noAisle = computeParkingMetrics(floor({ stalls: [touching], requested: 1 }))!;
    expect(noAisle.fulfilment.value).toBe(1);
    expect(noAisle.aisleAccess.value).toBeNull();
    expect(noAisle.stallAreaShare.value).toBeNull();
    expect(noAisle.streetAccess).toBeNull();
    expect(computeParkingMetrics(floor({ stalls: [touching], aisle }))!.fulfilment.value).toBeNull();
  });

  it('rectsTouch: shared edge or overlap counts, corner-only contact does not; rectUnionArea is exact', () => {
    expect(rectsTouch({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(true);
    expect(rectsTouch({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectsTouch({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 2, w: 2, h: 2 })).toBe(false);
    expect(rectUnionArea([{ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }])).toBeCloseTo(7, 12);
    expect(rectUnionArea([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Programme adjacency
// ---------------------------------------------------------------------------

describe('programme adjacency: required and door satisfaction', () => {
  const reqs: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([
    ['living', [req('dining', 3)]],
    ['dining', [req('kitchen', 3, true)]],
    ['kitchen', [req('kitchen', 3, true)]],     // self-type (as in the real programme) → N/A with one kitchen
    ['corridor', [req('stair-hall', 3, true)]], // no stair-hall on this floor → N/A
  ]);
  const base = (livingTouchesDining: boolean, doorDK: boolean) => floor({
    spaces: [
      { id: 'L', type: 'living', x: 0, y: 0, w: 4, h: 4, adj: livingTouchesDining ? ['D'] : [] },
      { id: 'D', type: 'dining', x: 4, y: 0, w: 3, h: 4, adj: [...(livingTouchesDining ? ['L'] : []), 'K'] },
      { id: 'K', type: 'kitchen', x: 7, y: 0, w: 3, h: 4, adj: ['D'] },
      { id: 'C', type: 'corridor', x: 0, y: 4, w: 10, h: 1 },
    ],
    walls: [{ id: 'wDK', a: 'D', b: 'K' }],
    openings: doorDK ? [{ id: 'dDK', wall: 'wDK', cx: 7, cy: 2 }] : [],
  });

  it('adjacent but no door: required (3+3)/6 = 1, door 0/3 = 0, two N/A instances', () => {
    const m = computeAdjacencyMetrics(base(true, false), reqs);
    expect(m.required).toMatchObject({ value: 1, num: 6, den: 6, basis: 'PROGRAM' });
    expect(m.door).toMatchObject({ value: 0, num: 0, den: 3 });
    expect(m.notApplicableCount).toBe(2);
    expect(m.instances.find(i => i.sourceSpaceId === 'K')).toMatchObject({ applicable: false, adjacencySatisfied: null, doorSatisfied: null });
  });

  it('door on the shared wall satisfies doorRequired: door 3/3', () => {
    expect(computeAdjacencyMetrics(base(true, true), reqs).door).toMatchObject({ value: 1, num: 3, den: 3 });
  });

  it('a window on the shared wall is not access', () => {
    const f = base(true, false);
    (f.openings as unknown as Array<Record<string, unknown>>).push({ id: 'win', type: 'window', wallId: 'wDK', center: { x: 7, y: 2 } });
    expect(computeAdjacencyMetrics(f, reqs).door.value).toBe(0);
  });

  it('missing adjacency: required 3/6 = 0.5', () => {
    expect(computeAdjacencyMetrics(base(false, false), reqs).required).toMatchObject({ value: 0.5, num: 3, den: 6 });
  });

  it('adjacency is symmetric: listed on either side counts', () => {
    const f = base(true, false);
    f.spaces.find(s => s.id === 'L')!.adjacentSpaceIds = []; // only D lists L
    expect(computeAdjacencyMetrics(f, reqs).required.value).toBe(1);
  });

  it('adjacent:false means "must be separated" (model semantics)', () => {
    const sep = new Map<SpaceType, AdjacencyRequirement[]>([['living', [req('kitchen', 2, false, false)]]]);
    expect(computeAdjacencyMetrics(base(true, false), sep).required).toMatchObject({ value: 1, num: 2, den: 2 });
    const touch = base(true, false);
    touch.spaces.find(s => s.id === 'L')!.adjacentSpaceIds.push('K');
    expect(computeAdjacencyMetrics(touch, sep).required.value).toBe(0);
  });

  it('null cases: no requirements, zero weights, missing target type', () => {
    const none = computeAdjacencyMetrics(base(true, false), new Map());
    expect(none.required.value).toBeNull();
    expect(none.door.value).toBeNull();
    expect(none.instances).toEqual([]);
    const zero = computeAdjacencyMetrics(base(true, false), new Map<SpaceType, AdjacencyRequirement[]>([['living', [req('dining', 0)]]]));
    expect(zero.required.value).toBeNull();
    const untargeted = computeAdjacencyMetrics(base(true, false), new Map<SpaceType, AdjacencyRequirement[]>([['living', [req(undefined, 3)]]]));
    expect(untargeted.instances[0]).toMatchObject({ targetType: null, applicable: false });
    expect(untargeted.required.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Circulation
// ---------------------------------------------------------------------------

describe('circulation: share, reach, detour, dead ends', () => {
  // E(0,0,2,2) — C(2,0,4,2) — R1(6,0,2,2); R2(2,2,4,2) above C.
  // doors: E|C at (2,1), C|R1 at (6,1), C|R2 at (5,2); street door on E's exterior wall.
  const spaces: Sp[] = [
    { id: 'E', type: 'entrance', x: 0, y: 0, w: 2, h: 2 },
    { id: 'C', type: 'corridor', x: 2, y: 0, w: 4, h: 2 },
    { id: 'R1', type: 'bedroom', x: 6, y: 0, w: 2, h: 2 },
    { id: 'R2', type: 'bedroom', x: 2, y: 2, w: 4, h: 2 },
  ];
  const walls: Wl[] = [{ id: 'wEC', a: 'E', b: 'C' }, { id: 'wCR1', a: 'C', b: 'R1' }, { id: 'wCR2', a: 'C', b: 'R2' }, { id: 'wExt', a: 'E', b: null }];
  const openings: Op[] = [
    { id: 'd1', wall: 'wEC', cx: 2, cy: 1 }, { id: 'd2', wall: 'wCR1', cx: 6, cy: 1 },
    { id: 'd3', wall: 'wCR2', cx: 5, cy: 2 }, { id: 'd0', wall: 'wExt', type: 'entrance', cx: 0, cy: 1 },
  ];

  it('hand values: share 12/24, reach 4/4, routes 6 and 1+√10+√2, detour (6+√13)/(7+√10+√2)', () => {
    const m = computeCirculationMetrics(floor({ spaces, walls, openings }));
    expect(m.originIds).toEqual(['E']);
    expect(m.share).toMatchObject({ value: 0.5, num: 12, den: 24 });
    expect(m.reach).toMatchObject({ value: 1, num: 4, den: 4 });
    const r1 = m.routes.find(r => r.targetId === 'R1')!;
    const r2 = m.routes.find(r => r.targetId === 'R2')!;
    expect(r1.route).toBeCloseTo(6, 12);               // (1,1)→(2,1)→(6,1)→(7,1)
    expect(r1.straight).toBeCloseTo(6, 12);
    expect(r2.route).toBeCloseTo(1 + Math.sqrt(10) + Math.sqrt(2), 12); // (1,1)→(2,1)→(5,2)→(4,3)
    expect(r2.straight).toBeCloseTo(Math.sqrt(13), 12);
    expect(m.detour.value).toBeCloseTo((6 + Math.sqrt(13)) / (7 + Math.sqrt(10) + Math.sqrt(2)), 12);
    expect(m.deadEnds).toBe(0);
    expect(m.routes.map(r => r.targetId)).toEqual(['R1', 'R2']);
  });

  it('isolated room lowers reach to 4/5, gets a null route and leaves detour unchanged; windows are not edges', () => {
    const iso = floor({
      spaces: [...spaces, { id: 'X', type: 'storage', x: 6, y: 2, w: 2, h: 2 }],
      walls: [...walls, { id: 'wCX', a: 'R2', b: 'X' }],
      openings: [...openings, { id: 'win', wall: 'wCX', type: 'window', cx: 6, cy: 3 }],
    });
    const m = computeCirculationMetrics(iso);
    expect(m.reach).toMatchObject({ num: 4, den: 5 });
    expect(m.routes.find(r => r.targetId === 'X')).toEqual({ targetId: 'X', originId: null, straight: null, route: null });
    expect(m.detour.value).toBeCloseTo((6 + Math.sqrt(13)) / (7 + Math.sqrt(10) + Math.sqrt(2)), 12);
  });

  it('dead end: corridor with a single door, counted once', () => {
    const f = floor({
      spaces: [{ id: 'E', type: 'entrance', x: 0, y: 0, w: 2, h: 2 }, { id: 'C', type: 'corridor', x: 2, y: 0, w: 4, h: 2 }, { id: 'R', type: 'bedroom', x: 0, y: 2, w: 2, h: 2 }],
      walls: [{ id: 'a', a: 'E', b: 'C' }, { id: 'b', a: 'E', b: 'R' }],
      openings: [{ id: 'o1', wall: 'a', cx: 2, cy: 1 }, { id: 'o2', wall: 'b', cx: 1, cy: 2 }],
    });
    const m = computeCirculationMetrics(f);
    expect(m.deadEnds).toBe(1);
    expect(m.deadEndIds).toEqual(['C']);
  });

  it('upper floor: stair-hall and elevator-hall are origins; the closer origin wins', () => {
    // S(0,0,2,2) and H(8,0,2,2) both open into corridor C(2,0,6,2); room R(6,2,2,2) off C at (7,2).
    const f = floor({
      level: 1,
      spaces: [
        { id: 'S', type: 'stair-hall', x: 0, y: 0, w: 2, h: 2 }, { id: 'H', type: 'elevator-hall', x: 8, y: 0, w: 2, h: 2 },
        { id: 'C', type: 'corridor', x: 2, y: 0, w: 6, h: 2 }, { id: 'R', type: 'bedroom', x: 6, y: 2, w: 2, h: 2 },
      ],
      walls: [{ id: 'a', a: 'S', b: 'C' }, { id: 'b', a: 'H', b: 'C' }, { id: 'c', a: 'C', b: 'R' }],
      openings: [{ id: 'o1', wall: 'a', cx: 2, cy: 1 }, { id: 'o2', wall: 'b', cx: 8, cy: 1 }, { id: 'o3', wall: 'c', cx: 7, cy: 2 }],
    });
    const m = computeCirculationMetrics(f);
    expect(m.originIds).toEqual(['H', 'S']);
    const r = m.routes[0];
    // from H: (9,1)→(8,1)=1, (8,1)→(7,2)=√2, (7,2)→(7,3)=1
    expect(r.originId).toBe('H');
    expect(r.route).toBeCloseTo(2 + Math.sqrt(2), 12);
    expect(r.straight).toBeCloseTo(Math.hypot(2, 2), 12);
  });

  it('null cases: no origin → reach/detour null (share still defined); empty floor → all null', () => {
    const noOrigin = computeCirculationMetrics(floor({ spaces: [{ id: 'C', type: 'corridor', x: 0, y: 0, w: 4, h: 1 }, { id: 'B', type: 'bedroom', x: 0, y: 1, w: 4, h: 3 }] }));
    expect(noOrigin.originIds).toEqual([]);
    expect(noOrigin.reach.value).toBeNull();
    expect(noOrigin.detour.value).toBeNull();
    expect(noOrigin.share.value).toBeCloseTo(0.25, 12);
    expect(noOrigin.routes).toEqual([{ targetId: 'B', originId: null, straight: null, route: null }]);
    const empty = computeCirculationMetrics(floor({}));
    expect(empty.share.value).toBeNull();
    expect(empty.reach.value).toBeNull();
    expect(empty.detour.value).toBeNull();
    expect(empty.deadEnds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Domain-model findings (open questions) + generated-layout regression
// ---------------------------------------------------------------------------

const RECT_SITE = { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8, setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const L_SITE = { ...RECT_SITE, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } };
const BUILDING = { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true };
const inputFor = (site: object, extra: object = {}): ProjectInput =>
  ({ name: 'q', site, building: { ...BUILDING, ...extra }, country: 'IR', deterministic: true, seed: 42 } as unknown as ProjectInput);
const firstCandidate = (input: ProjectInput) => generate(createProject(input), {}).candidates[0];

const CASES: Array<[string, ProjectInput]> = [
  ['rect', inputFor(RECT_SITE)],
  ['l-shape', inputFor(L_SITE)],
  ['rect+lift', inputFor(RECT_SITE, { hasElevator: true })],
];

describe('domain-model findings (open questions, verified on generated layouts)', () => {
  it('Q1: space polygons are wall-centreline cells — every wall lies on an edge of each space it bounds', () => {
    const onEdge = (w: Floor['walls'][number], r: Rect) => {
      const e = 1e-6;
      if (Math.abs(w.start.y - w.end.y) < e) {
        return (Math.abs(w.start.y - r.y) < e || Math.abs(w.start.y - (r.y + r.h)) < e)
          && Math.min(w.start.x, w.end.x) >= r.x - e && Math.max(w.start.x, w.end.x) <= r.x + r.w + e;
      }
      return (Math.abs(w.start.x - r.x) < e || Math.abs(w.start.x - (r.x + r.w)) < e)
        && Math.min(w.start.y, w.end.y) >= r.y - e && Math.max(w.start.y, w.end.y) <= r.y + r.h + e;
    };
    for (const [, input] of CASES) {
      for (const f of firstCandidate(input).floors) {
        const byId = new Map(f.spaces.map(s => [s.id, s]));
        expect(f.walls.length).toBeGreaterThan(0);
        for (const w of f.walls) {
          expect(w.thickness).toBeGreaterThan(0); // thickness exists but is not subtracted from spaces
          for (const id of w.spaceIds) if (id) expect(onEdge(w, byId.get(id)!.rect)).toBe(true);
        }
      }
    }
  });

  it('Q2: preferredAspectRatio is not populated by the generator', () => {
    for (const [, input] of CASES) {
      for (const f of firstCandidate(input).floors) {
        for (const s of f.spaces) {
          expect(s.preferredAspectRatio).toBeUndefined();
          expect(s.constraints?.preferredAspectRatio).toBeUndefined();
        }
      }
    }
  });

  it('floors carry the canonical buildable polygon at runtime (6 vertices for the L-shape)', () => {
    const f = firstCandidate(inputFor(L_SITE)).floors[0] as Floor & { buildableBoundary?: unknown[] };
    expect(f.buildableBoundary).toHaveLength(6);
  });

  it('programAdjacencyByType re-derives the generator programme; out-of-range level → empty', () => {
    const input = inputFor(RECT_SITE);
    const g = programAdjacencyByType(input, 0);
    expect(g.get('entrance')).toEqual([{ spaceType: 'foyer', adjacent: true, weight: 3, doorRequired: true }]);
    expect(g.get('corridor')?.map(r => r.spaceType)).toEqual(['stair-hall']);
    const u = programAdjacencyByType(input, 1);
    expect(u.get('master-bedroom')?.map(r => r.spaceType)).toEqual(['master-bathroom', 'corridor']);
    expect(programAdjacencyByType(input, 2).size).toBe(0);
    expect(programAdjacencyByType(input, -1).size).toBe(0);
  });
});

/** Compact, rounded view of the metrics for regression pinning. */
function summary(input: ProjectInput) {
  const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
  return computeQualityMetricsV1(firstCandidate(input), input).floors.map(f => ({
    level: f.level,
    envelope: r3(f.residual.envelopeArea),
    footprintRect: r3(f.residual.footprintRectArea),
    residual: r3(f.residual.residualArea),
    fragments: f.residual.fragmentCount,
    unusable: r3(f.residual.unusableArea),
    parking: f.parking && [f.parking.fulfilment.value, f.parking.aisleAccess.value, f.parking.streetAccess, r3(f.parking.stallAreaShare.value)],
    adjacency: [f.adjacency.required.num, f.adjacency.required.den, f.adjacency.door.num, f.adjacency.door.den, f.adjacency.notApplicableCount],
    circulation: [r3(f.circulation.share.value), r3(f.circulation.reach.value), r3(f.circulation.detour.value), f.circulation.deadEnds],
  }));
}

describe('generated layouts: determinism, purity, regression', () => {
  it('is deterministic and does not mutate the candidate', () => {
    for (const [, input] of CASES) {
      const c = firstCandidate(input);
      const before = JSON.stringify(c);
      const a = computeQualityMetricsV1(c, input);
      const b = computeQualityMetricsV1(c, input);
      expect(JSON.stringify(c)).toBe(before);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.version).toBe(1);
      // independent regeneration yields identical metrics
      expect(JSON.stringify(computeQualityMetricsV1(firstCandidate(input), input))).toBe(JSON.stringify(a));
    }
  });

  it('invariants hold on every floor', () => {
    for (const [, input] of CASES) {
      for (const f of computeQualityMetricsV1(firstCandidate(input), input).floors) {
        const r = f.residual;
        expect(r.envelopeSource).toBe('buildableBoundary∩footprint');
        expect(r.envelopeArea).toBeLessThanOrEqual(r.footprintRectArea + 1e-9);
        expect(r.occupiedArea + r.residualArea).toBeCloseTo(r.envelopeArea, 6);
        expect(r.fragments.reduce((s, x) => s + x.area, 0)).toBeCloseTo(r.residualArea, 6);
        expect(r.skippedNonAxisWalls).toBe(0);
        for (const v of [r.coverage.value, f.circulation.share.value, f.circulation.reach.value, f.circulation.detour.value, f.adjacency.required.value, f.adjacency.door.value]) {
          if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1 + 1e-12); }
        }
        for (const rt of f.circulation.routes) if (rt.route !== null) expect(rt.straight!).toBeLessThanOrEqual(rt.route + 1e-9);
        if (f.level > 0) expect(f.parking).toBeNull();
      }
    }
  });

  it('L-shape upper floor excludes the 4×6 notch from the envelope (real geometry)', () => {
    const up = summary(inputFor(L_SITE))[1];
    expect(up.footprintRect! - up.envelope!).toBeCloseTo(24, 6);
  });

  it('pinned values — rect', () => {
    expect(summary(CASES[0][1])).toEqual(PINNED.rect);
  });
  it('pinned values — l-shape', () => {
    expect(summary(CASES[1][1])).toEqual(PINNED.lshape);
  });
  it('pinned values — rect+lift', () => {
    expect(summary(CASES[2][1])).toEqual(PINNED.lift);
  });
});

// Values computed at 75216a7 + this module; any change means generator geometry or a
// formula changed and must be reviewed deliberately.
const PINNED: Record<'rect' | 'lshape' | 'lift', unknown> = {
  rect: [
    {level: 0, envelope: 256.13, footprintRect: 256.13, residual: 81.22, fragments: 2, unusable: 0, parking: [1, 1, true, 0.386], adjacency: [17, 17, 11, 14, 2], circulation: [0.306, 1, 0.668, 0]},
    {level: 1, envelope: 96.955, footprintRect: 96.955, residual: 10.985, fragments: 1, unusable: 0, parking: null, adjacency: [9, 9, 6, 9, 1], circulation: [0.359, 1, 0.531, 0]},
  ],
  lshape: [
    // Phase 5.3C: the programme's single corridor spec is realised as two corridor rooms here;
    // corridor → stair-hall (w 3, doorRequired) is now evaluated once per spec, not per room
    // (was [17, 20, 11, 17, 2] with the duplicate, unsatisfied per-room instance).
    {level: 0, envelope: 242.48, footprintRect: 242.48, residual: 75.68, fragments: 2, unusable: 0, parking: [1, 1, true, 0.386], adjacency: [17, 17, 11, 14, 2], circulation: [0.404, 1, 0.605, 0]},
    {level: 1, envelope: 255.6, footprintRect: 279.6, residual: 6.503, fragments: 1, unusable: 0, parking: null, adjacency: [9, 9, 6, 9, 1], circulation: [0.173, 1, 0.762, 0]},
  ],
  lift: [
    {level: 0, envelope: 256.13, footprintRect: 256.13, residual: 76.832, fragments: 2, unusable: 0, parking: [1, 1, true, 0.386], adjacency: [17, 17, 11, 14, 2], circulation: [0.327, 1, 0.668, 0]},
    {level: 1, envelope: 115.57, footprintRect: 115.57, residual: 20.869, fragments: 2, unusable: 2.394, parking: null, adjacency: [9, 9, 6, 9, 1], circulation: [0.416, 1, 0.601, 0]},
  ],
};

// ---------------------------------------------------------------------------
// 3b. Programme adjacency — Phase 5.3C split-room semantics
// ---------------------------------------------------------------------------

describe('programme adjacency: generated rooms outnumbering programme specs (Phase 5.3C)', () => {
  const corrReqs: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([
    ['corridor', [req('stair-hall', 3, true)]],
  ]);
  const counts = (entries: Array<[string, number]>): ProgramSpecCountByType => new Map(entries as Array<[SpaceType, number]>);
  /** One programme corridor realised as two corridor rooms; C2 (optionally) touches the stair. */
  const split = (c2TouchesStair: boolean, door: boolean) => floor({
    spaces: [
      { id: 'C1', type: 'corridor', x: 0, y: 0, w: 6, h: 1, adj: ['C2'] },
      { id: 'C2', type: 'corridor', x: 6, y: 0, w: 1, h: 6, adj: ['C1', ...(c2TouchesStair ? ['S'] : [])] },
      { id: 'S', type: 'stair-hall', x: c2TouchesStair ? 7 : 9, y: 0, w: 2, h: 3, adj: c2TouchesStair ? ['C2'] : [] },
    ],
    walls: c2TouchesStair ? [{ id: 'wCS', a: 'C2', b: 'S' }] : [],
    openings: c2TouchesStair && door ? [{ id: 'dCS', wall: 'wCS', cx: 7, cy: 1 }] : [],
  });

  it('split corridor, one room satisfies: the single programme requirement passes (adjacency and door)', () => {
    const m = computeAdjacencyMetrics(split(true, true), corrReqs, counts([['corridor', 1], ['stair-hall', 1]]));
    expect(m.required).toMatchObject({ value: 1, num: 3, den: 3 });
    expect(m.door).toMatchObject({ value: 1, num: 3, den: 3 });
    expect(m.instances).toHaveLength(1);
    expect(m.instances[0]).toMatchObject({ sourceSpaceId: 'C2', applicable: true, adjacencySatisfied: true, doorSatisfied: true, groupedSpaceIds: ['C1', 'C2'] });
    // legacy per-room evaluation (no spec counts) double-counts the requirement
    const legacy = computeAdjacencyMetrics(split(true, true), corrReqs);
    expect(legacy.required).toMatchObject({ num: 3, den: 6 });
    expect(legacy.door).toMatchObject({ num: 3, den: 6 });
  });

  it('split corridor, adjacent but no door: adjacency passes, doorRequired fails', () => {
    const m = computeAdjacencyMetrics(split(true, false), corrReqs, counts([['corridor', 1], ['stair-hall', 1]]));
    expect(m.required).toMatchObject({ num: 3, den: 3 });
    expect(m.door).toMatchObject({ value: 0, num: 0, den: 3 });
  });

  it('split corridor, neither room satisfies: the requirement fails', () => {
    const m = computeAdjacencyMetrics(split(false, false), corrReqs, counts([['corridor', 1], ['stair-hall', 1]]));
    expect(m.required).toMatchObject({ value: 0, num: 0, den: 3 });
    expect(m.door).toMatchObject({ value: 0, num: 0, den: 3 });
    expect(m.instances).toHaveLength(1);
    expect(m.instances[0]).toMatchObject({ adjacencySatisfied: false, doorSatisfied: false, groupedSpaceIds: ['C1', 'C2'] });
  });

  it('matching room/spec counts (and fewer rooms than specs) preserve the legacy result exactly', () => {
    const reqs: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([
      ['living', [req('dining', 3)]], ['dining', [req('kitchen', 3, true)]], ['corridor', [req('stair-hall', 3, true)]],
    ]);
    const f = floor({
      spaces: [
        { id: 'L', type: 'living', x: 0, y: 0, w: 4, h: 4, adj: ['D'] },
        { id: 'D', type: 'dining', x: 4, y: 0, w: 3, h: 4, adj: ['L', 'K'] },
        { id: 'K', type: 'kitchen', x: 7, y: 0, w: 3, h: 4, adj: ['D'] },
        { id: 'C', type: 'corridor', x: 0, y: 4, w: 10, h: 1 },
      ],
      walls: [{ id: 'wDK', a: 'D', b: 'K' }],
      openings: [{ id: 'dDK', wall: 'wDK', cx: 7, cy: 2 }],
    });
    const legacy = computeAdjacencyMetrics(f, reqs);
    expect(computeAdjacencyMetrics(f, reqs, counts([['living', 1], ['dining', 1], ['kitchen', 1], ['corridor', 1]]))).toEqual(legacy);
    expect(computeAdjacencyMetrics(f, reqs, counts([['living', 2], ['dining', 1], ['kitchen', 1], ['corridor', 3]]))).toEqual(legacy);
    expect(computeAdjacencyMetrics(f, reqs, new Map())).toEqual(legacy);
    expect(legacy.instances.every(i => i.groupedSpaceIds === undefined)).toBe(true);
  });

  it('multiple bedrooms with matching specs stay independently evaluated', () => {
    const bedReqs: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([['bedroom', [req('corridor', 3, true)]]]);
    const f = floor({
      spaces: [
        { id: 'B1', type: 'bedroom', x: 0, y: 0, w: 3, h: 3, adj: ['C'] },
        { id: 'B2', type: 'bedroom', x: 3, y: 0, w: 3, h: 3, adj: [] },
        { id: 'C', type: 'corridor', x: 0, y: 3, w: 3, h: 1, adj: ['B1'] },
      ],
    });
    const m = computeAdjacencyMetrics(f, bedReqs, counts([['bedroom', 2], ['corridor', 1]]));
    expect(m.required).toMatchObject({ num: 3, den: 6 });
    expect(m.instances.map(i => [i.sourceSpaceId, i.adjacencySatisfied, i.groupedSpaceIds])).toEqual([['B1', true, undefined], ['B2', false, undefined]]);
    expect(m).toEqual(computeAdjacencyMetrics(f, bedReqs));
  });

  it('generic grouping (any type, k > 1): satisfied instances = min(k, rooms touching)', () => {
    const bedReqs: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([['bedroom', [req('corridor', 3)]]]);
    const f = floor({
      spaces: [
        { id: 'B1', type: 'bedroom', x: 0, y: 0, w: 3, h: 3, adj: ['C'] },
        { id: 'B2', type: 'bedroom', x: 3, y: 0, w: 3, h: 3, adj: [] },
        { id: 'B3', type: 'bedroom', x: 6, y: 0, w: 3, h: 3, adj: [] },
        { id: 'C', type: 'corridor', x: 0, y: 3, w: 3, h: 1, adj: ['B1'] },
      ],
    });
    const m = computeAdjacencyMetrics(f, bedReqs, counts([['bedroom', 2]]));
    expect(m.instances).toHaveLength(2);
    expect(m.required).toMatchObject({ num: 3, den: 6 });
    expect(m.instances.map(i => [i.sourceSpaceId, i.adjacencySatisfied])).toEqual([['B1', true], ['B2', false]]);
  });

  it('grouped separation requirement passes only when no room of the type touches the target', () => {
    const sep: AdjacencyRequirementsByType = new Map<SpaceType, AdjacencyRequirement[]>([['corridor', [req('stair-hall', 2, false, false)]]]);
    const c = counts([['corridor', 1]]);
    expect(computeAdjacencyMetrics(split(false, false), sep, c).required).toMatchObject({ num: 2, den: 2 });
    expect(computeAdjacencyMetrics(split(true, false), sep, c).required).toMatchObject({ num: 0, den: 2 });
  });

  it('grouped rooms with no target on the floor are not applicable (one N/A per programme spec)', () => {
    const f = floor({ spaces: [
      { id: 'C1', type: 'corridor', x: 0, y: 0, w: 6, h: 1 }, { id: 'C2', type: 'corridor', x: 6, y: 0, w: 1, h: 6 },
    ] });
    const m = computeAdjacencyMetrics(f, corrReqs, counts([['corridor', 1]]));
    expect(m.notApplicableCount).toBe(1);
    expect(m.required.value).toBeNull();
  });

  it('deterministic and non-mutating under repeated evaluation', () => {
    const f = split(true, true);
    const before = JSON.stringify(f);
    const c = counts([['corridor', 1], ['stair-hall', 1]]);
    const a = computeAdjacencyMetrics(f, corrReqs, c), b = computeAdjacencyMetrics(f, corrReqs, c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(f)).toBe(before);
  });

  it('programSpecCountByType counts the generator programme per floor; out-of-range level → empty', () => {
    const input = {
      site: { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 },
      building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
      seed: 42, deterministic: true, jurisdiction: 'IR',
    } as unknown as ProjectInput;
    const g = programSpecCountByType(input, 0);
    expect(g.get('corridor')).toBe(1);
    expect(g.get('stair-hall')).toBe(1);
    expect(programSpecCountByType(input, 5).size).toBe(0);
  });

  it('L-shape split-corridor ground floor: corridor → stair-hall evaluated once and satisfied', () => {
    const input = {
      site: { shape: 'l-shape', width: 20, length: 26, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
        lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } },
      building: { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 },
      seed: 42, deterministic: true, jurisdiction: 'IR',
    } as unknown as ProjectInput;
    const cand = generate(createProject(input)).project.candidates.find(c => c.floors[0].spaces.filter(s => s.type === 'corridor').length > 1)!;
    expect(cand).toBeDefined();
    const g = computeQualityMetricsV1(cand, input).floors[0].adjacency.instances.filter(i => i.sourceType === 'corridor' && i.targetType === 'stair-hall');
    expect(g).toHaveLength(1);
    expect(g[0].adjacencySatisfied).toBe(true);
    expect(g[0].groupedSpaceIds!.length).toBeGreaterThan(1);
  });
});
