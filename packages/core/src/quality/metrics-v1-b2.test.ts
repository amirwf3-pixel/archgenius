/**
 * Phase 5.1b-2 — Quality Metrics V1: room usability, daylight, privacy, vertical
 * integration. Hand-checkable fixtures (expected values derived in comments), null
 * cases, domain-model findings on generated layouts, determinism and regression pins.
 */
import { describe, it, expect } from 'vitest';
import type { Floor } from '../model/floor.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import { createProject, generate } from '../pipeline.js';
import {
  computeRoomUsabilityMetrics, computeDaylightMetrics, computePrivacyMetrics, computeVerticalMetrics,
  computeQualityMetricsV1, windowFacing,
} from './metrics-v1.js';

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

type Sp = {
  id: string; type: string; x: number; y: number; w: number; h: number;
  privacy?: string; orientation?: string; daylight?: boolean; minWidth?: number; target?: number; par?: number;
  polygon?: Array<{ x: number; y: number }>;
};
type Wl = { id: string; a: string | null; b: string | null; kind?: string };
type Op = { id: string; wall: string; type?: 'door' | 'entrance' | 'sliding-door' | 'window'; normal?: { x: number; y: number }; w?: number; h?: number };
type El = { rect: { x: number; y: number; w: number; h: number }; core?: string; hall: string };

function floor(o: {
  level?: number; spaces?: Sp[]; walls?: Wl[]; openings?: Op[]; accessSide?: 'north' | 'south' | 'east' | 'west';
  stairs?: Array<{ x: number; y: number; w: number; h: number }>; elevators?: El[]; elevatorRequested?: boolean;
}): Floor {
  const level = o.level ?? 0;
  return {
    level, footprint: { x: 0, y: 0, w: 20, h: 20 }, accessSide: o.accessSide,
    spaces: (o.spaces ?? []).map(s => ({
      id: s.id, type: s.type, label: s.id, privacy: s.privacy ?? 'public', zone: 'public',
      orientation: s.orientation, daylightRequired: s.daylight,
      rect: { x: s.x, y: s.y, w: s.w, h: s.h },
      polygon: s.polygon ?? [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }],
      area: s.polygon ? polyArea(s.polygon) : s.w * s.h,
      targetArea: s.target ?? 0, minArea: 0, minWidth: s.minWidth, preferredAspectRatio: s.par,
      wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: level,
    })),
    walls: (o.walls ?? []).map(w => ({ id: w.id, kind: w.kind ?? 'interior', thickness: 0.15, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, spaceIds: [w.a, w.b], openingIds: [], floor: level })),
    openings: (o.openings ?? []).map(p => ({
      id: p.id, type: p.type ?? 'door', wallId: p.wall, center: { x: 0, y: 0 }, wallDir: { x: 1, y: 0 },
      normal: p.normal ?? { x: 0, y: 1 }, width: p.w ?? 0.9, height: p.h ?? 2.1, sill: 0, floor: level,
    })),
    stairs: (o.stairs ?? []).map((r, i) => ({ id: `st${level}-${i}`, footprint: r, rect: r, floor: level, flights: [], landings: [] })),
    elevators: (o.elevators ?? []).map((e, i) => ({ id: `el${level}-${i}`, rect: e.rect, coreId: e.core ?? 'core-lift', hallSpaceId: e.hall, floor: level })),
    elevatorRequested: o.elevatorRequested,
    furniture: [], parkingStalls: [],
  } as unknown as Floor;
}
function polyArea(p: Array<{ x: number; y: number }>): number {
  let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2;
}
const cand = (floors: Floor[]) => ({ id: 'c', floors, findings: [] } as unknown as LayoutCandidate);
// window normals point INTO the room (Q3): a room north of its south facade has normal (0,1)
const INTO_FROM_SOUTH = { x: 0, y: 1 }, INTO_FROM_NORTH = { x: 0, y: -1 }, INTO_FROM_EAST = { x: -1, y: 0 };

// ---------------------------------------------------------------------------
// 5. Room usability / proportion
// ---------------------------------------------------------------------------

describe('rooms: widthFit, areaFit, rectangularity, aspect', () => {
  const base = floor({ spaces: [
    { id: 'A', type: 'bedroom', x: 0, y: 0, w: 3, h: 4, minWidth: 2.5, target: 12 },  // A=12, fit 1 / 1
    { id: 'B', type: 'bedroom', x: 3, y: 0, w: 2, h: 5, minWidth: 2.5, target: 12.5 }, // A=10, width 2/2.5=0.8, area 1−2.5/12.5=0.8
    { id: 'C', type: 'corridor', x: 0, y: 5, w: 5, h: 1, minWidth: 1.1, target: 4 },   // circulation → excluded
  ] });

  it('hand values: widthFit (12·1+10·0.8)/22, areaFit (1+0.8)/2, rectangularity 22/22, aspect null', () => {
    const m = computeRoomUsabilityMetrics(base);
    expect(m.roomCount).toBe(2);
    expect(m.widthFit).toMatchObject({ num: 20, den: 22, basis: 'PROGRAM' });
    expect(m.widthFit.value).toBeCloseTo(20 / 22, 12);
    expect(m.areaFit.value).toBeCloseTo(0.9, 12);
    expect(m.areaFit.den).toBe(2);
    expect(m.rectangularity).toMatchObject({ value: 1, num: 22, den: 22, basis: 'GEOMETRIC' });
    expect(m.aspect.value).toBeNull(); // preferredAspectRatio absent → not invented
    expect(m.belowMinWidthCount).toBe(1);
    const b = m.rooms.find(r => r.spaceId === 'B')!;
    expect(b).toMatchObject({ minSide: 2, maxSide: 5, aspectRatio: 2.5, rectangularity: 1, aspectFit: null });
    expect(b.widthFit).toBeCloseTo(0.8, 12);
    expect(b.areaFit).toBeCloseTo(0.8, 12);
  });

  it('L-shaped room polygon: rectangularity 84/100', () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 }];
    const m = computeRoomUsabilityMetrics(floor({ spaces: [{ id: 'A', type: 'living', x: 0, y: 0, w: 10, h: 10, polygon: L }] }));
    expect(m.rectangularity.value).toBeCloseTo(0.84, 12);
  });

  it('aspect is computed only where preferredAspectRatio exists: min(α,α*)/max(α,α*)', () => {
    const m = computeRoomUsabilityMetrics(floor({ spaces: [
      { id: 'A', type: 'bedroom', x: 0, y: 0, w: 2, h: 4, par: 1.5 }, // α=2   → 1.5/2 = 0.75
      { id: 'B', type: 'bedroom', x: 2, y: 0, w: 3, h: 3, par: 1.5 }, // α=1   → 1/1.5
      { id: 'C', type: 'bedroom', x: 5, y: 0, w: 3, h: 3 },           // none  → excluded
    ] }));
    expect(m.aspect.den).toBe(2);
    expect(m.aspect.value).toBeCloseTo((0.75 + 1 / 1.5) / 2, 12);
  });

  it('areaFit clamps at 0 for ≥100 % deviation; null cases', () => {
    const big = computeRoomUsabilityMetrics(floor({ spaces: [{ id: 'A', type: 'living', x: 0, y: 0, w: 5, h: 5, target: 10 }] }));
    expect(big.areaFit.value).toBe(0); // |25−10|/10 = 1.5 → clamp → 0
    expect(big.widthFit.value).toBeNull();
    expect(big.belowMinWidthCount).toBeNull();
    const none = computeRoomUsabilityMetrics(floor({ spaces: [{ id: 'C', type: 'corridor', x: 0, y: 0, w: 5, h: 1 }] }));
    expect(none.roomCount).toBe(0);
    for (const v of [none.widthFit, none.areaFit, none.rectangularity, none.aspect]) expect(v.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Daylight
// ---------------------------------------------------------------------------

describe('daylight: facing, windowed, orientation, depth', () => {
  it('windowFacing = cardinal of −normal (normals point into the room)', () => {
    expect(windowFacing({ x: 0, y: 1 })).toBe('south');
    expect(windowFacing({ x: 0, y: -1 })).toBe('north');
    expect(windowFacing({ x: -1, y: 0 })).toBe('east');
    expect(windowFacing({ x: 1, y: 0 })).toBe('west');
    expect(windowFacing({ x: 0.2, y: -0.9 })).toBe('north');
    expect(windowFacing({ x: Math.SQRT1_2, y: Math.SQRT1_2 })).toBeNull();
    expect(windowFacing({ x: 0, y: 0 })).toBeNull();
    expect(windowFacing(undefined)).toBeNull();
  });

  const layout = (livingNormal: { x: number; y: number }) => floor({
    spaces: [
      { id: 'R', type: 'living', x: 0, y: 0, w: 4, h: 6, daylight: true, orientation: 'south' },
      { id: 'K', type: 'kitchen', x: 4, y: 0, w: 3, h: 3, daylight: true, orientation: 'any' },
      { id: 'B', type: 'bedroom', x: 0, y: 6, w: 4, h: 3, daylight: true, orientation: 'east' },
      { id: 'X', type: 'storage', x: 4, y: 3, w: 3, h: 3 },
    ],
    walls: [
      { id: 'wR', a: 'R', b: null, kind: 'exterior' }, { id: 'wB', a: 'B', b: null, kind: 'exterior' },
      { id: 'wKX', a: 'K', b: 'X' },
    ],
    openings: [
      { id: 'o1', wall: 'wR', type: 'window', normal: livingNormal, w: 1.5, h: 1.2 },
      { id: 'o2', wall: 'wB', type: 'window', normal: INTO_FROM_EAST, w: 1.0, h: 1.0 },
      { id: 'o3', wall: 'wKX', type: 'window', normal: INTO_FROM_SOUTH, w: 1, h: 1 }, // two-sided wall → not facade
    ],
  });

  it('hand values: windowed 2/3, orientation 2/2, depths R=h=6, B=w=4, glazed 1.8 m²', () => {
    const m = computeDaylightMetrics(layout(INTO_FROM_SOUTH));
    expect(m.windowed).toMatchObject({ num: 2, den: 3 });
    expect(m.orientation).toMatchObject({ value: 1, num: 2, den: 2 }); // K ('any') excluded
    expect(m.nonFacadeWindows).toBe(1);
    const r = m.rooms.find(x => x.spaceId === 'R')!;
    expect(r).toMatchObject({ facings: ['south'], depth: 6, windowCount: 1, windowWidth: 1.5, orientationPref: 'south' });
    expect(r.glazedArea).toBeCloseTo(1.8, 12);
    expect(m.rooms.find(x => x.spaceId === 'B')).toMatchObject({ facings: ['east'], depth: 4 });
    expect(m.rooms.find(x => x.spaceId === 'K')).toMatchObject({ windowCount: 0, depth: null, orientationPref: null });
    expect(m.maxDepth).toBe(6);
  });

  it('a window on the wrong facade fails orientation: 1/2', () => {
    const m = computeDaylightMetrics(layout(INTO_FROM_NORTH));
    expect(m.orientation).toMatchObject({ value: 0.5, num: 1, den: 2 });
    expect(m.rooms.find(x => x.spaceId === 'R')!.facings).toEqual(['north']);
  });

  it('two facades: depth = min over windows (south → h, east → w)', () => {
    const m = computeDaylightMetrics(floor({
      spaces: [{ id: 'R', type: 'living', x: 0, y: 0, w: 5, h: 8, daylight: true }],
      walls: [{ id: 's', a: 'R', b: null }, { id: 'e', a: 'R', b: null }],
      openings: [{ id: 'o1', wall: 's', type: 'window', normal: INTO_FROM_SOUTH }, { id: 'o2', wall: 'e', type: 'window', normal: INTO_FROM_EAST }],
    }));
    expect(m.rooms[0]).toMatchObject({ facings: ['east', 'south'], depth: 5 });
  });

  it('null cases: no daylight-required rooms, no preferences, no windows', () => {
    const m = computeDaylightMetrics(floor({ spaces: [{ id: 'X', type: 'storage', x: 0, y: 0, w: 2, h: 2 }] }));
    expect(m.windowed.value).toBeNull();
    expect(m.orientation.value).toBeNull();
    expect(m.maxDepth).toBeNull();
    expect(computeDaylightMetrics(floor({})).rooms).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Privacy
// ---------------------------------------------------------------------------

describe('privacy: buffered, exposure, street-facing windows', () => {
  // E(entrance) – F(foyer) – L(living) ; F – C(corridor) – B1 – BA(ensuite) ; L – B2 (bedroom off living)
  const spaces: Sp[] = [
    { id: 'E', type: 'entrance', x: 0, y: 0, w: 2, h: 2, privacy: 'public' },
    { id: 'F', type: 'foyer', x: 2, y: 0, w: 2, h: 2, privacy: 'public' },
    { id: 'L', type: 'living', x: 4, y: 0, w: 4, h: 4, privacy: 'public' },
    { id: 'C', type: 'corridor', x: 2, y: 2, w: 2, h: 4, privacy: 'service' },
    { id: 'B1', type: 'bedroom', x: 0, y: 6, w: 4, h: 3, privacy: 'private' },
    { id: 'BA', type: 'bathroom', x: 0, y: 9, w: 2, h: 2, privacy: 'private' },
    { id: 'B2', type: 'bedroom', x: 8, y: 0, w: 3, h: 4, privacy: 'private' },
  ];
  const walls: Wl[] = [
    { id: 'EF', a: 'E', b: 'F' }, { id: 'FL', a: 'F', b: 'L' }, { id: 'FC', a: 'F', b: 'C' }, { id: 'CB1', a: 'C', b: 'B1' },
    { id: 'B1BA', a: 'B1', b: 'BA' }, { id: 'LB2', a: 'L', b: 'B2' },
    { id: 'xB1', a: 'B1', b: null, kind: 'exterior' }, { id: 'xB2', a: 'B2', b: null, kind: 'exterior' },
  ];
  const doors: Op[] = ['EF', 'FL', 'FC', 'CB1', 'B1BA', 'LB2'].map(w => ({ id: `d${w}`, wall: w }));
  const wins: Op[] = [
    { id: 'wB1', wall: 'xB1', type: 'window', normal: INTO_FROM_SOUTH, w: 2 }, // faces south
    { id: 'wB2', wall: 'xB2', type: 'window', normal: INTO_FROM_EAST, w: 1 },  // faces east
  ];

  it('hand values: buffered 2/3 (B2 exposed via living), exposure 3/4, street-facing 1 − 2/3', () => {
    const m = computePrivacyMetrics(floor({ spaces, walls, openings: [...doors, ...wins], accessSide: 'south' }));
    expect(m.originIds).toEqual(['E']);
    expect(m.buffered).toMatchObject({ num: 2, den: 3 });
    expect(m.rooms.find(r => r.spaceId === 'B2')).toMatchObject({ exposed: true, publicDoors: 1, doors: 1 });
    expect(m.rooms.find(r => r.spaceId === 'B1')).toMatchObject({ exposed: false, publicDoors: 0, doors: 2 });
    expect(m.rooms.find(r => r.spaceId === 'BA')).toMatchObject({ exposed: false, doors: 1 });
    // doors per private room: B1 {C, BA}, BA {B1}, B2 {L}: 4 total, 1 onto a public space
    expect(m.exposure).toMatchObject({ value: 0.75, num: 3, den: 4 });
    expect(m.streetFacingPrivate).toMatchObject({ num: 1, den: 3 });
  });

  it('a street door into a private room counts as a public door', () => {
    const m = computePrivacyMetrics(floor({ spaces, walls, openings: [...doors, { id: 'st', wall: 'xB1', type: 'entrance' }] }));
    expect(m.exposure).toMatchObject({ num: 3, den: 5 });
    expect(m.streetFacingPrivate.value).toBeNull(); // no accessSide
  });

  it('upper floor: a bedroom opening straight onto the stair-hall origin is exposed', () => {
    const m = computePrivacyMetrics(floor({
      level: 1,
      spaces: [{ id: 'S', type: 'stair-hall', x: 0, y: 0, w: 2, h: 2, privacy: 'service' }, { id: 'B', type: 'bedroom', x: 2, y: 0, w: 3, h: 3, privacy: 'private' }],
      walls: [{ id: 'SB', a: 'S', b: 'B' }], openings: [{ id: 'd', wall: 'SB' }],
    }));
    expect(m.originIds).toEqual(['S']);
    expect(m.buffered).toMatchObject({ value: 0, num: 0, den: 1 });
    expect(m.exposure.value).toBe(1); // stair-hall is not a public-band space
  });

  it('null cases: unreachable private room, no origin, no private rooms', () => {
    const iso = computePrivacyMetrics(floor({ spaces: [spaces[0], { id: 'B', type: 'bedroom', x: 5, y: 5, w: 3, h: 3, privacy: 'private' }] }));
    expect(iso.rooms[0]).toMatchObject({ reachable: false, exposed: null, doors: 0 });
    expect(iso.buffered.value).toBeNull();
    expect(iso.exposure.value).toBeNull();
    const noOrigin = computePrivacyMetrics(floor({ spaces: [{ id: 'B', type: 'bedroom', x: 0, y: 0, w: 3, h: 3, privacy: 'private' }] }));
    expect(noOrigin.originIds).toEqual([]);
    expect(noOrigin.buffered.value).toBeNull();
    const pub = computePrivacyMetrics(floor({ spaces: [spaces[0]] }));
    expect(pub.rooms).toEqual([]);
    for (const v of [pub.buffered, pub.exposure, pub.streetFacingPrivate]) expect(v.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Vertical integration
// ---------------------------------------------------------------------------

describe('vertical: stair/lift alignment, core reach, lift–stair link, step-free', () => {
  const stair = { x: 0, y: 0, w: 2, h: 4 };
  const shaft = { x: 5, y: 0, w: 2, h: 2 };

  it('stair alignment reuses stairFootprintOverlap: pairs 1 and 0.5 → mean 0.75, min 0.5', () => {
    const v = computeVerticalMetrics(cand([
      floor({ level: 0, stairs: [stair] }),
      floor({ level: 1, stairs: [stair] }),
      floor({ level: 2, stairs: [{ ...stair, x: 1 }] }), // overlap 1×4 = 4 / min area 8 = 0.5
    ]));
    expect(v.pairs.map(p => p.stairOverlap)).toEqual([1, 0.5]);
    expect(v.stairAlign).toMatchObject({ value: 0.75, num: 1.5, den: 2 });
    expect(v.minStairOverlap).toBe(0.5);
    expect(v.liftAlign.value).toBeNull(); // no elevators anywhere
  });

  it('a floor missing its stair contributes overlap 0; no stairs at all → null', () => {
    expect(computeVerticalMetrics(cand([floor({ level: 0, stairs: [stair] }), floor({ level: 1 })])).stairAlign).toMatchObject({ value: 0, den: 1 });
    expect(computeVerticalMetrics(cand([floor({ level: 0 }), floor({ level: 1 })])).stairAlign.value).toBeNull();
    expect(computeVerticalMetrics(cand([floor({ level: 0, stairs: [stair] })])).stairAlign.value).toBeNull(); // single floor
  });

  it('lift alignment is geometric: identical 1 (exact stack), shifted 0.5 m → 3/4, requested-but-missing → 0', () => {
    const e = (r = shaft, core = 'k') => ({ rect: r, core, hall: 'H' });
    const same = computeVerticalMetrics(cand([floor({ level: 0, elevators: [e()] }), floor({ level: 1, elevators: [e()] })]));
    expect(same.pairs[0]).toMatchObject({ liftOverlap: 1, liftExactStack: true });
    const shifted = computeVerticalMetrics(cand([floor({ level: 0, elevators: [e()] }), floor({ level: 1, elevators: [e({ ...shaft, x: 5.5 })] })]));
    expect(shifted.pairs[0].liftOverlap).toBeCloseTo(0.75, 12); // 1.5×2 / 4
    expect(shifted.pairs[0].liftExactStack).toBe(false);
    const otherCore = computeVerticalMetrics(cand([floor({ level: 0, elevators: [e()] }), floor({ level: 1, elevators: [e(shaft, 'z')] })]));
    expect(otherCore.pairs[0]).toMatchObject({ liftOverlap: 1, liftExactStack: false });
    const missing = computeVerticalMetrics(cand([floor({ level: 0, elevators: [e()], elevatorRequested: true }), floor({ level: 1, elevatorRequested: true })]));
    expect(missing.liftAlign).toMatchObject({ value: 0, den: 1 });
    expect(missing.minLiftOverlap).toBe(0);
  });

  it('core reach and lift–stair door steps', () => {
    // level 0: H – C – S and C – R door-connected (H→S = 2 steps); level 1: S1 – R1, H1 and X1 unconnected
    const f0 = floor({
      level: 0,
      spaces: [
        { id: 'H', type: 'elevator-hall', x: 0, y: 0, w: 2, h: 2 }, { id: 'C', type: 'corridor', x: 2, y: 0, w: 4, h: 2 },
        { id: 'S', type: 'stair-hall', x: 6, y: 0, w: 2, h: 2 }, { id: 'R', type: 'bedroom', x: 2, y: 2, w: 4, h: 3 },
      ],
      walls: [{ id: 'a', a: 'H', b: 'C' }, { id: 'b', a: 'C', b: 'S' }, { id: 'c', a: 'C', b: 'R' }],
      openings: [{ id: 'o1', wall: 'a' }, { id: 'o2', wall: 'b' }, { id: 'o3', wall: 'c' }],
      elevators: [{ rect: shaft, hall: 'H' }],
    });
    const f1 = floor({
      level: 1,
      spaces: [{ id: 'S1', type: 'stair-hall', x: 6, y: 0, w: 2, h: 2 }, { id: 'R1', type: 'bedroom', x: 2, y: 0, w: 4, h: 3 }, { id: 'X1', type: 'storage', x: 0, y: 5, w: 2, h: 2 }, { id: 'H1', type: 'elevator-hall', x: 0, y: 0, w: 2, h: 2 }],
      walls: [{ id: 'a', a: 'S1', b: 'R1' }], openings: [{ id: 'o1', wall: 'a' }],
      elevators: [{ rect: shaft, hall: 'H1' }],
    });
    const v = computeVerticalMetrics(cand([f0, f1]));
    expect(v.floors[0]).toMatchObject({ coreHallIds: ['H', 'S'], coreServesAll: true, liftToStairDoorSteps: 2 });
    // level 1: H1 has no door to S1 → no lift–stair link; X1 is isolated → core does not serve all
    expect(v.floors[1]).toMatchObject({ coreHallIds: ['H1', 'S1'], coreServesAll: false, liftToStairDoorSteps: null });
    expect(v.coreReach).toMatchObject({ value: 0.5, num: 1, den: 2 });
    expect(v.liftStairLinked).toMatchObject({ value: 0.5, num: 1, den: 2 });
  });

  it('core reach fails when a space cannot be reached from any core hall', () => {
    const f = floor({
      level: 1,
      spaces: [{ id: 'S', type: 'stair-hall', x: 0, y: 0, w: 2, h: 2 }, { id: 'R', type: 'bedroom', x: 2, y: 0, w: 3, h: 3 }, { id: 'X', type: 'storage', x: 5, y: 0, w: 2, h: 2 }],
      walls: [{ id: 'a', a: 'S', b: 'R' }], openings: [{ id: 'o', wall: 'a' }],
    });
    const v = computeVerticalMetrics(cand([floor({ level: 0, spaces: [{ id: 'S0', type: 'stair-hall', x: 0, y: 0, w: 2, h: 2 }] }), f]));
    expect(v.floors.map(x => x.coreServesAll)).toEqual([true, false]);
    expect(v.coreReach).toMatchObject({ value: 0.5, num: 1, den: 2 });
  });

  it('step-free reuses validation/accessibility stepFreeReachable; null without a street entrance', () => {
    const g = floor({
      level: 0,
      spaces: [{ id: 'E', type: 'entrance', x: 0, y: 0, w: 2, h: 2 }, { id: 'R', type: 'living', x: 2, y: 0, w: 4, h: 4 }],
      walls: [{ id: 'x', a: 'E', b: null, kind: 'exterior' }, { id: 'er', a: 'E', b: 'R' }],
      openings: [{ id: 'st', wall: 'x', type: 'entrance' }, { id: 'd', wall: 'er' }],
    });
    const up = floor({ level: 1, spaces: [{ id: 'B', type: 'bedroom', x: 0, y: 0, w: 3, h: 3 }] });
    expect(computeVerticalMetrics(cand([g, up])).stepFree).toMatchObject({ num: 2, den: 3 }); // no lift: upper floor unreached
    const noStreet = floor({ level: 0, spaces: [{ id: 'R', type: 'living', x: 0, y: 0, w: 4, h: 4 }] });
    expect(computeVerticalMetrics(cand([noStreet])).stepFree.value).toBeNull();
    const empty = computeVerticalMetrics(cand([]));
    expect(empty.floorCount).toBe(0);
    for (const m of [empty.stairAlign, empty.liftAlign, empty.coreReach, empty.liftStairLinked, empty.stepFree]) expect(m.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Domain-model findings + generated-layout regression
// ---------------------------------------------------------------------------

const RECT_SITE = { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8, setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };
const L_SITE = { ...RECT_SITE, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } };
const BUILDING = { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true };
const inputFor = (site: object, extra: object = {}): ProjectInput =>
  ({ name: 'q', site, building: { ...BUILDING, ...extra }, country: 'IR', deterministic: true, seed: 42 } as unknown as ProjectInput);
const first = (input: ProjectInput) => generate(createProject(input), {}).candidates[0];

const CASES: Array<[string, ProjectInput]> = [
  ['rect', inputFor(RECT_SITE)],
  ['l-shape', inputFor(L_SITE)],
  ['rect 3-floor lift', inputFor(RECT_SITE, { floors: 3, bedrooms: 3, hasElevator: true })],
];

describe('domain-model findings (verified on generated layouts)', () => {
  it('Q3: every window normal points into its room and every window sits on a one-sided exterior wall', () => {
    let n = 0;
    for (const [, input] of CASES) for (const f of first(input).floors) {
      const walls = new Map(f.walls.map(w => [w.id, w]));
      const spaces = new Map(f.spaces.map(s => [s.id, s]));
      for (const o of f.openings.filter(x => x.type === 'window')) {
        const w = walls.get(o.wallId)!;
        const ids = w.spaceIds.filter(Boolean) as string[];
        expect(w.kind).toBe('exterior');
        expect(ids).toHaveLength(1);
        const r = spaces.get(ids[0])!.rect;
        const p = { x: o.center.x + o.normal.x * 0.05, y: o.center.y + o.normal.y * 0.05 };
        expect(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h).toBe(true);
        n++;
      }
    }
    expect(n).toBe(19);
  });

  it('Q4: Space.orientation is south for living/master-bedroom and any otherwise (programme east/west lost)', () => {
    for (const [, input] of CASES) for (const f of first(input).floors) for (const s of f.spaces) {
      expect(s.orientation).toBe(s.type === 'living' || s.type === 'master-bedroom' ? 'south' : 'any');
    }
  });

  it('Q6: stairs exist on every floor with one footprint; elevators share one coreId and rect', () => {
    const c = first(CASES[2][1]);
    const fps = c.floors.map(f => JSON.stringify(f.stairs[0].footprint));
    expect(new Set(fps).size).toBe(1);
    expect(c.floors.every(f => f.elevators.length === 1 && f.elevators[0].coreId === c.floors[0].elevators[0].coreId)).toBe(true);
  });
});

function summary(input: ProjectInput) {
  const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
  const q = computeQualityMetricsV1(first(input), input);
  return {
    floors: q.floors.map(f => ({
      level: f.level,
      rooms: [f.rooms.roomCount, r3(f.rooms.widthFit.value), r3(f.rooms.areaFit.value), r3(f.rooms.rectangularity.value), f.rooms.aspect.value, f.rooms.belowMinWidthCount],
      daylight: [f.daylight.windowed.num, f.daylight.windowed.den, f.daylight.orientation.num, f.daylight.orientation.den, r3(f.daylight.maxDepth)],
      privacy: [r3(f.privacy.buffered.value), r3(f.privacy.exposure.value), r3(f.privacy.streetFacingPrivate.value)],
    })),
    vertical: [r3(q.vertical.stairAlign.value), r3(q.vertical.liftAlign.value), r3(q.vertical.coreReach.value), r3(q.vertical.liftStairLinked.value), q.vertical.stepFree.num, q.vertical.stepFree.den],
  };
}

describe('generated layouts: determinism, purity, invariants, regression', () => {
  it('deterministic, non-mutating, and identical across independent regeneration', () => {
    for (const [, input] of CASES) {
      const c = first(input);
      const before = JSON.stringify(c);
      const a = JSON.stringify(computeQualityMetricsV1(c, input));
      expect(JSON.stringify(computeQualityMetricsV1(c, input))).toBe(a);
      expect(JSON.stringify(c)).toBe(before);
      expect(JSON.stringify(computeQualityMetricsV1(first(input), input))).toBe(a);
    }
  });

  it('every MetricValue lies in [0,1] or is null; aspect stays null (preferredAspectRatio never populated)', () => {
    for (const [, input] of CASES) {
      const q = computeQualityMetricsV1(first(input), input);
      const vals = [
        ...q.floors.flatMap(f => [f.rooms.widthFit, f.rooms.areaFit, f.rooms.rectangularity, f.rooms.aspect, f.daylight.windowed, f.daylight.orientation, f.privacy.buffered, f.privacy.exposure, f.privacy.streetFacingPrivate]),
        q.vertical.stairAlign, q.vertical.liftAlign, q.vertical.coreReach, q.vertical.liftStairLinked, q.vertical.stepFree,
      ];
      for (const m of vals) if (m.value !== null) { expect(m.value).toBeGreaterThanOrEqual(0); expect(m.value).toBeLessThanOrEqual(1); }
      for (const f of q.floors) {
        expect(f.rooms.aspect.value).toBeNull();
        for (const r of f.daylight.rooms) if (r.windowCount === 0) expect(r.depth).toBeNull();
      }
    }
  });

  it('pinned values — rect', () => { expect(summary(CASES[0][1])).toEqual(PINNED.rect); });
  it('pinned values — l-shape', () => { expect(summary(CASES[1][1])).toEqual(PINNED.lshape); });
  it('pinned values — rect 3-floor lift', () => { expect(summary(CASES[2][1])).toEqual(PINNED.lift3); });
});

// Values computed at 75216a7 + this module; a change means generator geometry or a formula
// changed and must be reviewed deliberately.
const PINNED: Record<'rect' | 'lshape' | 'lift3', unknown> = {
  rect: {
    floors: [
      {level:  0, rooms:  [4, 1, 0.081, 1, null, 0], daylight:  [3, 3, 1, 1, 8.22], privacy:  [null, null, null]},
      {level:  1, rooms:  [3, 1, 0.368, 1, null, 0], daylight:  [2, 2, 0, 1, 6.58], privacy:  [1, 1, 1]},
    ],
    vertical: [1, null, 1, null, 8, 13],
  },
  lshape: {
    floors: [
      {level:  0, rooms:  [4, 1, 0.174, 1, null, 0], daylight:  [3, 3, 1, 1, 9.28], privacy:  [null, null, null]},
      {level:  1, rooms:  [3, 1, 0.097, 1, null, 0], daylight:  [2, 2, 1, 1, 12.7], privacy:  [1, 1, 0.556]},
    ],
    vertical: [1, null, 1, null, 9, 15],
  },
  lift3: {
    floors: [
      {level:  0, rooms:  [4, 1, 0.081, 1, null, 0], daylight:  [3, 3, 1, 1, 8.22], privacy:  [null, null, null]},
      {level:  1, rooms:  [3, 1, 0.368, 1, null, 0], daylight:  [2, 2, 0, 1, 6.58], privacy:  [1, 1, 1]},
      {level:  2, rooms:  [1, 1, 0.251, 1, null, 0], daylight:  [1, 1, 0, 0, 3.19], privacy:  [1, 1, 1]},
    ],
    vertical: [1, 1, 1, 1, 19, 19],
  },
};
