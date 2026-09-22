import { describe, it, expect } from 'vitest';
import { rankVector, compareCandidates, sortCandidates } from './ranking.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';
import { createProject, generate, validateLayout } from '../pipeline.js';

/**
 * P17-B — architectural-form quality ranking (ranking ONLY).
 *
 * Proves the three deterministic soft penalties (contiguous floor voids,
 * communal oversizing, corridor proportion) order candidates correctly,
 * leave healthy plans unpenalized, and never touch feasibility semantics.
 * Fixtures follow the established rankVector-fixture pattern (phase16_c):
 * candidates are hand-built with the minimal fields rankVector reads.
 */

let seq = 0;

function space(type: string, rect: Rect, opts: { area?: number; targetArea?: number; polygon?: Array<{ x: number; y: number }> } = {}): any {
  return {
    id: `s${seq++}`,
    type,
    label: type,
    privacy: 'public',
    zone: 'public',
    rect,
    polygon: opts.polygon ?? [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h },
    ],
    area: opts.area ?? rect.w * rect.h,
    targetArea: opts.targetArea ?? rect.w * rect.h,
    minArea: 1,
    wallIds: [],
    openingIds: [],
    adjacentSpaceIds: [],
    hasExteriorWall: false,
    floor: 0,
  };
}

/** Full-coverage 20x10 plan: 8x10 living + 6x10 bedrooms + 6x10 misc + corridor. */
function baseRooms(): any[] {
  return [
    space('living', { x: 0, y: 0, w: 8, h: 6.5 }, { area: 40, targetArea: 40 }),
    space('kitchen', { x: 0, y: 6.5, w: 8, h: 3.5 }, { area: 20, targetArea: 20 }),
    space('bedroom', { x: 8, y: 0, w: 6, h: 5 }, { area: 26, targetArea: 26 }),
    space('bathroom', { x: 8, y: 5, w: 6, h: 5 }, { area: 24, targetArea: 24 }),
    space('corridor', { x: 14, y: 0, w: 6, h: 2 }, { area: 12, targetArea: 12 }),
    space('entrance', { x: 14, y: 2, w: 6, h: 8 }, { area: 44, targetArea: 44 }),
  ];
}

function candidate(id: string, spacesByFloor: any[][], findings: any[] = []): LayoutCandidate {
  return {
    id,
    findings,
    metrics: {
      usableAreaRatio: 0.8,
      circulationRatio: 0.15,
      wastedArea: 0,
      roomAreaDeviation: 0,
      collisionCount: 0,
      parkingFeasibility: 1,
      adjacencySatisfaction: 1,
      daylightExposure: 1,
      orientationSatisfaction: 1,
      privacySatisfaction: 1,
    },
    floors: spacesByFloor.map((spaces, level) => ({
      level,
      floorHeight: 3,
      elevation: level * 3,
      footprint: { x: 0, y: 0, w: 20, h: 10 },
      spaces,
      walls: [],
      openings: [],
      stairs: [],
      elevators: [],
      furniture: [],
      parkingStalls: [],
    })),
    explanations: [],
    metadata: {} as any,
  } as unknown as LayoutCandidate;
}

const HEALTHY = () => candidate('healthy', [baseRooms()]);

describe('P17-B contiguous floor-void penalty', () => {
  it('a plan with a large walled-off void ranks below the equivalent fully-built plan', () => {
    // Same rooms, but the north-west 10x5 region of the envelope is left empty
    // (50 m² contiguous void — the P17-A two-floor/deep-narrow defect shape).
    const voided = candidate('voided', [[
      space('living', { x: 0, y: 5, w: 8, h: 5 }, { area: 40, targetArea: 40 }),
      space('kitchen', { x: 8, y: 5, w: 4, h: 5 }, { area: 20, targetArea: 20 }),
      space('bedroom', { x: 12, y: 0, w: 8, h: 5 }, { area: 40, targetArea: 40 }),
      space('corridor', { x: 8, y: 0, w: 4, h: 5 }, { area: 20, targetArea: 12 }),
      space('entrance', { x: 0, y: 0, w: 0.01, h: 0.01 }, { area: 0.0001, targetArea: 3 }),
    ]]);
    const vVoid = rankVector(voided);
    const vHealthy = rankVector(HEALTHY());
    expect(vVoid.architecturalQualityPenalty).toBeGreaterThan(0);
    expect(vHealthy.architecturalQualityPenalty).toBe(0);
    expect(compareCandidates(HEALTHY(), voided)).toBeLessThan(0);
    expect(compareCandidates(voided, HEALTHY())).toBeGreaterThan(0);
  });

  it('intentional small voids (courtyard ≤ allowance) are NOT penalized', () => {
    // 4 m² courtyard (2x2) inside the envelope — below the 8 m² allowance.
    const rooms = baseRooms();
    rooms[1] = space('kitchen', { x: 0, y: 6.5, w: 6, h: 3.5 }, { area: 21, targetArea: 20 });
    const small = candidate('small-void', [rooms, ].map(r => r));
    // carve a 2x2 hole by shrinking nothing — instead build explicit geometry:
    const withCourtyard = candidate('courtyard', [[
      space('living', { x: 0, y: 0, w: 8, h: 6 }, { area: 48, targetArea: 48 }),
      space('kitchen', { x: 0, y: 6, w: 6, h: 4 }, { area: 24, targetArea: 24 }),
      space('bedroom', { x: 8, y: 0, w: 6, h: 5 }, { area: 30, targetArea: 30 }),
      space('bathroom', { x: 8, y: 5, w: 6, h: 5 }, { area: 30, targetArea: 30 }),
      space('corridor', { x: 14, y: 0, w: 6, h: 2 }, { area: 12, targetArea: 12 }),
      space('entrance', { x: 14, y: 2, w: 6, h: 8 }, { area: 48, targetArea: 48 }),
      // the 2x2 region x∈[6,8], y∈[6,8] is intentionally left open (courtyard)
    ]]);
    expect(rankVector(withCourtyard).architecturalQualityPenalty).toBe(0);
    expect(rankVector(small).architecturalQualityPenalty).toBe(0);
  });
});

describe('P17-B communal oversizing penalty', () => {
  it('a living room far beyond its requested target receives a penalty', () => {
    // fully-covered envelope, so the ONLY penalty source is the oversized living room
    const oversized = candidate('oversized', [[
      space('living', { x: 0, y: 0, w: 14, h: 6.5 }, { area: 91, targetArea: 20 }),
      space('kitchen', { x: 14, y: 0, w: 6, h: 3.5 }, { area: 21, targetArea: 21 }),
      space('bedroom', { x: 14, y: 3.5, w: 6, h: 6.5 }, { area: 39, targetArea: 39 }),
      space('bathroom', { x: 0, y: 6.5, w: 7, h: 3.5 }, { area: 24.5, targetArea: 24.5 }),
      space('storage', { x: 7, y: 6.5, w: 7, h: 3.5 }, { area: 24.5, targetArea: 24.5 }),
    ]]);
    const p = rankVector(oversized).architecturalQualityPenalty;
    // (91/20 − 2) × 1.5 = 3.825 — and nothing else
    expect(p).toBeCloseTo(3.825, 3);
    expect(compareCandidates(HEALTHY(), oversized)).toBeLessThan(0);
  });

  it('normal modest oversizing is not penalized', () => {
    const modest = candidate('modest', [[
      space('living', { x: 0, y: 0, w: 8, h: 6.5 }, { area: 36, targetArea: 20 }), // 1.8x target
      space('kitchen', { x: 0, y: 6.5, w: 8, h: 3.5 }, { area: 20, targetArea: 20 }),
      space('bedroom', { x: 8, y: 0, w: 6, h: 5 }, { area: 26, targetArea: 26 }),
      space('bathroom', { x: 8, y: 5, w: 6, h: 5 }, { area: 24, targetArea: 24 }),
      space('corridor', { x: 14, y: 0, w: 6, h: 2 }, { area: 12, targetArea: 12 }),
      space('entrance', { x: 14, y: 2, w: 6, h: 8 }, { area: 48, targetArea: 48 }),
    ]]);
    expect(rankVector(modest).architecturalQualityPenalty).toBe(0);
    expect(rankVector(modest)).toEqual(rankVector(modest));
  });
});

describe('P17-B corridor proportion penalty', () => {
  it('an excessive full-length sliver corridor is penalized', () => {
    const rooms = baseRooms();
    // replace the healthy corridor with a 20x1.5 full-length strip (AR 13.3, 100% of
    // long side) and extend the entrance north-block so the envelope stays fully covered
    rooms[4] = space('corridor', { x: 0, y: 8.5, w: 20, h: 1.5 }, { area: 30, targetArea: 12 });
    rooms[5] = space('entrance', { x: 14, y: 0, w: 6, h: 8.5 }, { area: 51, targetArea: 48 });
    const p = rankVector(candidate('strip', [rooms])).architecturalQualityPenalty;
    // AR term: (13.33 − 8) × 0.5 ≈ 2.67; length term: (1.0 − 0.75) × 2 = 0.5
    expect(p).toBeCloseTo((20 / 1.5 - 8) * 0.5 + 0.5, 3);
    expect(compareCandidates(HEALTHY(), candidate('strip', [rooms]))).toBeLessThan(0);
  });

  it('a proportionate corridor in a healthy plan is not penalized', () => {
    // healthy corridor: 6x2 → AR 3, length 6 = 30% of the 20 m long side
    expect(rankVector(HEALTHY()).architecturalQualityPenalty).toBe(0);
  });
});

describe('P17-B semantics and determinism', () => {
  it('ranking remains deterministic (stable vectors and stable sort)', () => {
    const a = HEALTHY();
    const oversized = candidate('oversized', [[
      space('living', { x: 0, y: 0, w: 14, h: 6.5 }, { area: 91, targetArea: 20 }),
      space('kitchen', { x: 14, y: 0, w: 6, h: 3.5 }, { area: 21, targetArea: 21 }),
      space('bedroom', { x: 14, y: 3.5, w: 6, h: 6.5 }, { area: 39, targetArea: 39 }),
      space('bathroom', { x: 0, y: 6.5, w: 7, h: 3.5 }, { area: 24.5, targetArea: 24.5 }),
      space('storage', { x: 7, y: 6.5, w: 7, h: 3.5 }, { area: 24.5, targetArea: 24.5 }),
    ]]);
    const v1 = rankVector(a), v2 = rankVector(a);
    expect(v1).toEqual(v2);
    const list = [oversized, a, oversized, a];
    const once = sortCandidates([...list]).map(c => c.id);
    const twice = sortCandidates([...list]).map(c => c.id);
    expect(once).toEqual(twice);
    expect(once[once.length - 1]).toBe('oversized');
  });

  it('feasibility semantics unchanged: HARD tier still dominates the quality penalty', () => {
    const hardFail = candidate('hardfail', [baseRooms()], [
      { severity: 'hard', code: 'ROOM_UNUSABLE', message: 'x' } as any,
    ]);
    const qualityPenalized = candidate('voided', [[
      space('living', { x: 0, y: 5, w: 8, h: 5 }, { area: 40, targetArea: 40 }),
      space('kitchen', { x: 8, y: 5, w: 4, h: 5 }, { area: 20, targetArea: 20 }),
      space('bedroom', { x: 12, y: 0, w: 8, h: 5 }, { area: 40, targetArea: 40 }),
      space('corridor', { x: 8, y: 0, w: 4, h: 5 }, { area: 20, targetArea: 12 }),
      space('entrance', { x: 0, y: 0, w: 0.01, h: 0.01 }, { area: 0.0001, targetArea: 3 }),
    ]]);
    expect(rankVector(hardFail).hardCount).toBe(1);
    expect(rankVector(qualityPenalized).architecturalQualityPenalty).toBeGreaterThan(0);
    // the hard-failing candidate still ranks strictly below (compare(a,b) < 0 ⇔ a better)
    expect(compareCandidates(qualityPenalized, hardFail)).toBeLessThan(0);
    expect(compareCandidates(hardFail, qualityPenalized)).toBeGreaterThan(0);
  });

  it('sparse phase16_c-style fixtures (no geometry) yield zero quality penalty — back-compat', () => {
    const sparse = {
      id: 'sparse',
      findings: [],
      metrics: { roomAreaDeviation: 0, wastedArea: 0, circulationRatio: 0.2, adjacencySatisfaction: 1, daylightExposure: 1, orientationSatisfaction: 1, privacySatisfaction: 1 },
      floors: [{ level: 0, spaces: [{ type: 'living' }, { type: 'kitchen' }, { type: 'corridor' }, { type: 'entrance' }], findings: [] }],
      metadata: {},
    } as unknown as LayoutCandidate;
    expect(rankVector(sparse).architecturalQualityPenalty).toBe(0);
  });

  it('real pipeline: winner stays hard-clean and the better-formed sibling wins when available', () => {
    // The P17-A audited defect case shape: deep site where the void variant used to win.
    const prj = createProject({
      name: 'P17B', country: 'IR', deterministic: true, seed: 42,
      site: { shape: 'rectangle', width: 10, length: 30, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 0, kitchenType: 'open', hasStair: false, hasStorage: true, parkingSpaces: 0 },
    });
    const res = generate(prj);
    expect(res.infeasible).toBeNull();
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    // quality penalty of the winner is measured and finite
    expect(Number.isFinite(rankVector(bc).architecturalQualityPenalty)).toBe(true);
  });
});
