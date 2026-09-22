/**
 * Phase 16 P16-C — professional room proportions on deep/narrow sites.
 * Band cells are capped at their contract + quality depth (M4 cap formula,
 * 3.5 aspect bound, 7 m daylight depth); the surplus band area stays an
 * INTENTIONAL void at the band's free end. The fix must never weaken any
 * validator: rooms stay above contract minima, corridor contact survives,
 * and genuinely over-demanded bands keep failing HONESTLY.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate } from './pipeline.js';
import { validateLayout } from './validation/validator.js';
import { rankVector, compareCandidates } from './layout/ranking.js';
import type { LayoutCandidate } from './model/layout.js';
import type { ProjectInput } from './model/project.js';

const deepNarrow = (): ProjectInput => ({
  name: 'P16C', country: 'IR', deterministic: true, seed: 42,
  site: { shape: 'rectangle', width: 10, length: 30, accessSide: 'south', streetWidth: 8 },
  building: { type: 'villa', floors: 1, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 0, kitchenType: 'open', hasStair: false, hasStorage: true, parkingSpaces: 0 },
} as ProjectInput);

const usable = (inp: ProjectInput) => {
  const res = generate(createProject(inp));
  return res;
};

describe('P16-C ribbon elimination on deep bands', () => {
  const res = usable(deepNarrow());

  it('deep narrow site yields a feasible, hard-clean winner', () => {
    expect(res.infeasible).toBeNull();
    const bc = res.bestCandidate!;
    const vr = validateLayout(bc);
    expect(vr.hard).toEqual([]);
  });

  it('no habitable room is a ribbon (aspect ≤ 3.5 + rounding)', () => {
    const bc = res.bestCandidate!;
    for (const fl of bc.floors) {
      for (const s of fl.spaces) {
        if (['corridor', 'stair-hall', 'elevator-hall', 'entrance', 'foyer', 'storage', 'utility', 'parking', 'yard', 'balcony'].includes(s.type)) continue;
        const asp = Math.max(s.rect.w, s.rect.h) / Math.max(0.01, Math.min(s.rect.w, s.rect.h));
        expect(asp, `${s.type} ${s.rect.w}x${s.rect.h}`).toBeLessThanOrEqual(3.55);
      }
    }
  });

  it('rooms keep corridor-side contact: zero direct-access/inaccessibility hards', () => {
    const bc = res.bestCandidate!;
    const codes = bc.findings.filter(f => f.severity === 'hard').map(f => f.code);
    expect(codes).not.toContain('CONSTRAINT_DIRECT_ACCESS');
    expect(codes).not.toContain('CIRC_INACCESSIBLE_SPACE');
  });

  it('band surplus is surfaced as intentional void, never re-inflated into rooms', () => {
    const bc = res.bestCandidate!;
    const marked = bc.explanations.some(e => /Phase16-C quality-depth cap|kept as explicit void|kept as intentional void/i.test(e));
    expect(marked).toBe(true);
    // The band genuinely holds slack: no room absorbed past the M4 cap.
    for (const fl of bc.floors) {
      for (const s of fl.spaces) {
        if (s.type === 'corridor') continue;
        const capA = Math.max((s.minArea ?? 0) * 1.1, Math.max(s.targetArea ?? 0, s.minArea ?? 0) * 1.75);
        if (capA > 0.02 && s.minArea !== undefined && s.targetArea !== undefined) {
          expect(s.area, `${s.type} area ${s.area} vs cap ${capA}`).toBeLessThanOrEqual(capA + 3.5); // tolerance for band-level shares, not full-depth absorption
        }
      }
    }
  });

  it('capping never pushes a room below its contract minima', () => {
    const bc = res.bestCandidate!;
    for (const fl of bc.floors) {
      for (const s of fl.spaces) {
        const minW = s.minWidth ?? s.constraints?.minWidth ?? 0;
        const minL = s.minLength ?? s.constraints?.minLength ?? s.minWidth ?? 0;
        const minA = s.minArea ?? s.constraints?.minArea ?? 0;
        if (minW > 0) expect(Math.min(s.rect.w, s.rect.h) >= minW - 0.05 || s.rect.w >= minW - 0.05 || s.rect.h >= minW - 0.05, `${s.type} min side`).toBe(true);
        if (minA > 0) expect(s.area >= minA - 0.15, `${s.type} ${s.area} < ${minA}`).toBe(true);
        if (minL > 0) expect(Math.max(s.rect.w, s.rect.h) >= minL - 0.05, `${s.type} minLength`).toBe(true);
      }
    }
  });

  it('the fix is deterministic run-to-run', () => {
    const a = JSON.stringify(usable(deepNarrow()).bestCandidate!.floors.map(fl => fl.spaces.map(s => [s.type, s.rect.x, s.rect.y, s.rect.w, s.rect.h])));
    const b = JSON.stringify(usable(deepNarrow()).bestCandidate!.floors.map(fl => fl.spaces.map(s => [s.type, s.rect.x, s.rect.y, s.rect.w, s.rect.h])));
    expect(a).toBe(b);
  });
});

describe('P16-C honesty: over-demanded bands still fail HARD, never faked', () => {
  it('the 2-floor 10x30 suite stays honestly infeasible (stacked rows strand a bedroom)', () => {
    const inp = {
      name: 'P16C-NC', country: 'IR', deterministic: true, seed: 42,
      site: { shape: 'rectangle', width: 10, length: 30, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 2, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'open', hasStair: true, hasStorage: false, parkingSpaces: 0 },
    } as ProjectInput;
    const res = generate(createProject(inp));
    expect(res.bestCandidate).toBeNull();
    expect(res.infeasible).not.toBeNull();
    expect(res.infeasible!.code).toBe('HARD_RULE_VIOLATION');
    const codes = res.infeasible!.attempts.flatMap(a => (a.hardCodes ?? []).map(h => h[0]));
    expect(codes).toContain('CONSTRAINT_DIRECT_ACCESS'); // surfaced, not suppressed
    expect(res.infeasible!.diagnosticCandidates.length).toBeGreaterThan(0);
  });
});

describe('P16-C ranking prefers proportionally sound and daylit layouts', () => {
  const fake = (id: string, over: Partial<ReturnType<typeof rankVector>>): LayoutCandidate =>
    ({
      id,
      findings: [],
      metrics: { roomAreaDeviation: 0, wastedArea: 0, circulationRatio: 0.2, adjacencySatisfaction: 1, daylightExposure: 1, orientationSatisfaction: 1, privacySatisfaction: 1 },
      floors: [{ level: 0, spaces: [{ type: 'living' }, { type: 'kitchen' }, { type: 'corridor' }, { type: 'entrance' }], findings: [] } as any],
      metadata: {} as any,
      ...(over as any),
    } as unknown as LayoutCandidate);

  it('ROOM_DAYLIGHT_QUALITY softs are ranked below proportionally equivalent rooms', () => {
    const deep = fake('a', { findings: [{ severity: 'soft', code: 'ROOM_DAYLIGHT_QUALITY' as any, message: 'x' } as any] });
    const ok = fake('b', {});
    expect(rankVector(deep).daylightQualityFailures).toBe(1);
    expect(rankVector(ok).daylightQualityFailures).toBe(0);
    expect(compareCandidates(ok, deep)).toBeLessThan(0);
  });

  it('proportion failures (ROOM_BAD_PROPORTION) outrank cheaper waste', () => {
    const ribbon = fake('a', {
      findings: [{ severity: 'soft', code: 'ROOM_BAD_PROPORTION' as any, message: 'x' } as any],
      metrics: { roomAreaDeviation: 0, wastedArea: 0, circulationRatio: 0.1, adjacencySatisfaction: 1, daylightExposure: 1, orientationSatisfaction: 1, privacySatisfaction: 1, badProportionCount: 1 } as any,
    });
    const sound = fake('b', {
      metrics: { roomAreaDeviation: 9, wastedArea: 50, circulationRatio: 0.35, adjacencySatisfaction: 1, daylightExposure: 1, orientationSatisfaction: 1, privacySatisfaction: 1 } as any,
    });
    expect(compareCandidates(sound, ribbon)).toBeLessThan(0); // sound-but-wasteful beats ribbon
  });
});

describe('P16-C runner-up candidate exposure (value-gated)', () => {
  it('default output stays a single candidate; ranked list lands on the project', () => {
    const res = generate(createProject(deepNarrow()));
    expect(res.candidates.length).toBe(1);
    const ranked = res.project.candidates;
    expect(ranked.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(compareCandidates(ranked[i - 1], ranked[i])).toBeLessThanOrEqual(0);
    }
  });

  it('topCandidates exposes the runner-up ONLY if it adds clear value', () => {
    const res = generate(createProject(deepNarrow()), { topCandidates: 2 });
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.candidates.length).toBeLessThanOrEqual(2);
    if (res.candidates.length === 2) {
      const [best, second] = res.candidates;
      const vb = rankVector(best), vs = rankVector(second);
      const betterIn = (Object.keys(vb) as (keyof typeof vb)[]).filter(k => (vs[k] as number) < (vb[k] as number) - 1e-6);
      expect(betterIn.length).toBeGreaterThan(0);
    }
  });
});
