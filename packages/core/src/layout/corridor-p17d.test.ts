import { describe, it, expect } from 'vitest';
import { rankVector, compareCandidates, sortCandidates } from './ranking.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';
import { createProject, generate, validateLayout } from '../pipeline.js';
import { buildStressCases } from '../stress/matrix.js';

/**
 * P17-D — corridor quality ranking (ranking ONLY, no placement changes).
 *
 * The corridor term of the architectural-quality penalty scores each connected
 * corridor SYSTEM once (merged segments — no double counting) with continuous
 * quadratic ramps: AR beyond 8 and dominant run beyond 75% of the floor's long
 * side. Proves: healthy → 0, sliver → penalized, pure excess length → penalized,
 * legitimate deep-site spines are not disproportionately penalized, determinism,
 * HARD feasibility semantics unchanged, and P17-B/P17-C behavior preserved.
 */

let seq = 0;

function space(type: string, rect: Rect, opts: { area?: number; targetArea?: number } = {}): any {
  return {
    id: `s${seq++}`,
    type,
    label: type,
    privacy: 'public',
    zone: 'public',
    rect,
    polygon: [
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

function candidate(id: string, footprint: Rect, spacesByFloor: any[][], findings: any[] = []): LayoutCandidate {
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
      footprint,
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

const ENVELOPE: Rect = { x: 0, y: 0, w: 20, h: 10 };

/** Healthy 20x10 plan: fully tiled, corridor 6x2 (AR 3, span 30%). */
function healthyRooms(): any[] {
  return [
    space('living', { x: 0, y: 0, w: 8, h: 6.5 }),
    space('kitchen', { x: 0, y: 6.5, w: 8, h: 3.5 }),
    space('bedroom', { x: 8, y: 0, w: 6, h: 5 }),
    space('bathroom', { x: 8, y: 5, w: 6, h: 5 }),
    space('corridor', { x: 14, y: 0, w: 6, h: 2 }),
    space('entrance', { x: 14, y: 2, w: 6, h: 8 }),
  ];
}

const HEALTHY = () => candidate('healthy', ENVELOPE, [healthyRooms()]);

describe('P17-D corridor quality penalty', () => {
  it('a healthy corridor receives exactly zero penalty', () => {
    // 6x2 corridor: AR 3 (< 8), span 6/20 = 0.3 (< 0.75) — both ramps closed.
    expect(rankVector(HEALTHY()).architecturalQualityPenalty).toBe(0);
  });

  it('an excessively high aspect ratio sliver is penalized (AR 16, span 100%)', () => {
    // 20x1.25 full-length sliver: AR term 0.06·(16−8)² = 3.84, span term 4·0.25² = 0.25.
    const rooms = [
      space('living', { x: 0, y: 0, w: 7, h: 8.75 }),
      space('bedroom', { x: 7, y: 0, w: 7, h: 8.75 }),
      space('entrance', { x: 14, y: 0, w: 6, h: 8.75 }),
      space('corridor', { x: 0, y: 8.75, w: 20, h: 1.25 }),
    ];
    const p = rankVector(candidate('sliver', ENVELOPE, [rooms])).architecturalQualityPenalty;
    expect(p).toBeCloseTo(0.06 * 8 * 8 + 4 * 0.25 * 0.25, 3);
    expect(compareCandidates(HEALTHY(), candidate('sliver', ENVELOPE, [rooms]))).toBeLessThan(0);
  });

  it('an excessively long but proportionate corridor is penalized by the span ramp alone', () => {
    // 20x3 corridor spanning the full 20 m floor: AR 6.67 (< 8 → zero),
    // span 1.0 → pure length signal 4·(0.25)² = 0.25.
    const rooms = [
      space('living', { x: 0, y: 0, w: 8, h: 7 }),
      space('bedroom', { x: 8, y: 0, w: 6, h: 7 }),
      space('entrance', { x: 14, y: 0, w: 6, h: 7 }),
      space('corridor', { x: 0, y: 7, w: 20, h: 3 }),
    ];
    const p = rankVector(candidate('long', ENVELOPE, [rooms])).architecturalQualityPenalty;
    expect(p).toBeCloseTo(0.25, 3);
    expect(p).toBeGreaterThan(0);
  });

  it('a legitimate full-length spine on a deep site is NOT disproportionately penalized', () => {
    // 10x17.5 floor with a 1.5x17.5 spine (AR 11.67, span 1.0): the long
    // corridor is forced by the deep site. Penalty ≈ 1.057 — materially below
    // half of the same-span sliver case (4.09).
    const fp: Rect = { x: 0, y: 0, w: 10, h: 17.5 };
    const rooms = [
      space('corridor', { x: 0, y: 0, w: 1.5, h: 17.5 }),
      space('living', { x: 1.5, y: 0, w: 4.25, h: 17.5 }),
      space('bedroom', { x: 5.75, y: 0, w: 4.25, h: 17.5 }),
    ];
    const p = rankVector(candidate('deep', fp, [rooms])).architecturalQualityPenalty;
    expect(p).toBeCloseTo(0.06 * (17.5 / 1.5 - 8) ** 2 + 0.25, 2);
    expect(p).toBeLessThan(0.5 * (0.06 * 8 * 8 + 0.25));
  });

  it('touching corridor segments are merged into ONE system (no double counting)', () => {
    // Spine 20x1.5 @ y5 + entrance patch 1.5x5 @ x0 touching it: merged system
    // bbox 20x6.5, union area 37.5 → run 20, width 1.875, AR 10.67.
    // Merged penalty: 0.06·(10.67−8)² + 0.25 ≈ 0.677 (per-rect double count
    // would be ≈ 2.21).
    const rooms = [
      space('corridor', { x: 0, y: 0, w: 1.5, h: 5 }),
      space('living', { x: 1.5, y: 0, w: 9.25, h: 5 }),
      space('bedroom', { x: 10.75, y: 0, w: 9.25, h: 5 }),
      space('corridor', { x: 0, y: 5, w: 20, h: 1.5 }),
      space('bathroom', { x: 0, y: 6.5, w: 10, h: 3.5 }),
      space('entrance', { x: 10, y: 6.5, w: 10, h: 3.5 }),
    ];
    const p = rankVector(candidate('merged', ENVELOPE, [rooms])).architecturalQualityPenalty;
    expect(p).toBeCloseTo(0.06 * (20 / (37.5 / 20) - 8) ** 2 + 4 * 0.25 ** 2, 3);
    expect(p).toBeLessThan(2.21); // the old per-segment double-counted value
  });

  it('ranking is deterministic (stable vectors, stable sort)', () => {
    const v1 = rankVector(HEALTHY());
    const v2 = rankVector(HEALTHY());
    expect(v1).toEqual(v2);
    const sliver = candidate('sliver', ENVELOPE, [[
      space('living', { x: 0, y: 0, w: 7, h: 8.75 }),
      space('bedroom', { x: 7, y: 0, w: 7, h: 8.75 }),
      space('entrance', { x: 14, y: 0, w: 6, h: 8.75 }),
      space('corridor', { x: 0, y: 8.75, w: 20, h: 1.25 }),
    ]]);
    const list = [sliver, HEALTHY(), sliver, HEALTHY()];
    const once = sortCandidates([...list]).map(c => c.id);
    const twice = sortCandidates([...list]).map(c => c.id);
    expect(once).toEqual(twice);
    expect(once[once.length - 1]).toBe('sliver');
  });

  it('HARD feasibility semantics unchanged: hard findings still dominate the corridor penalty', () => {
    const hardFail = candidate('hardfail', ENVELOPE, [healthyRooms()], [
      { code: 'GEO_ROOMS_OVERLAP', severity: 'hard', message: 'overlap', delta: 1 },
    ]);
    const cleanWithSliver = candidate('clean-sliver', ENVELOPE, [[
      space('living', { x: 0, y: 0, w: 7, h: 8.75 }),
      space('bedroom', { x: 7, y: 0, w: 7, h: 8.75 }),
      space('entrance', { x: 14, y: 0, w: 6, h: 8.75 }),
      space('corridor', { x: 0, y: 8.75, w: 20, h: 1.25 }),
    ]]);
    // sliver plan carries a real quality penalty, yet the hard-failing plan still ranks last
    expect(rankVector(cleanWithSliver).architecturalQualityPenalty).toBeGreaterThan(0);
    expect(sortCandidates([hardFail, cleanWithSliver]).map(c => c.id)).toEqual(['clean-sliver', 'hardfail']);
    // pipeline winners remain hard-clean (no new HARD findings introduced)
    const input = JSON.parse(JSON.stringify(buildStressCases().find(c => c.id === 'R10x34--S0-1bd-open')!.input));
    const res = generate(createProject(input));
    expect(res.bestCandidate).not.toBeNull();
    expect(validateLayout(res.bestCandidate!).hard).toEqual([]);
  });

  it('P17-B/P17-C ranking behavior preserved (communal, void, compaction)', () => {
    // communal oversize term unchanged: (91/20 − 2)·1.5 = 3.825
    const oversized = candidate('oversized', ENVELOPE, [[
      space('living', { x: 0, y: 0, w: 14, h: 6.5 }, { area: 91, targetArea: 20 }),
      space('kitchen', { x: 14, y: 0, w: 6, h: 3.5 }),
      space('bedroom', { x: 14, y: 3.5, w: 6, h: 6.5 }),
      space('bathroom', { x: 0, y: 6.5, w: 7, h: 3.5 }),
      space('storage', { x: 7, y: 6.5, w: 7, h: 3.5 }),
    ]]);
    expect(rankVector(oversized).architecturalQualityPenalty).toBeCloseTo(3.825, 3);
    // contiguous-void term still fires on a large uncovered region
    const voided = candidate('voided', ENVELOPE, [[
      space('living', { x: 0, y: 5, w: 8, h: 5 }),
      space('kitchen', { x: 8, y: 5, w: 4, h: 5 }),
      space('bedroom', { x: 12, y: 0, w: 8, h: 5 }),
      space('corridor', { x: 8, y: 0, w: 4, h: 5 }),
    ]]);
    expect(rankVector(voided).architecturalQualityPenalty).toBeGreaterThan(0);
    // P17-C compaction intact: deep-narrow envelope still shrinks to placed geometry
    const input = JSON.parse(JSON.stringify(buildStressCases().find(c => c.id === 'R10x34--S0-1bd-open')!.input));
    const bc = generate(createProject(input)).bestCandidate!;
    expect(bc.floors[0].footprint.h).toBeLessThan(24);
  });
});
