import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { validateAccessibility, stepFreeReachable, accessibleSanitaryFootprint } from './validation/accessibility.js';
import { IR_NATIONAL_MBR_PACK } from './regulations/packs/ir-national-mbr.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/layout.js';
import type { Floor } from './model/floor.js';

/**
 * Accessibility phase — standalone, deterministic 2D step-free route advisories.
 * No verified accessibility requirement exists in the repository, so every
 * finding is ADVISORY / REQUIRES_SOURCE_VERIFICATION; nothing is ever HARD and
 * nothing is merged into candidate.findings (generation/ranking/DXF unaffected).
 */

const SB = { setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 };

function input(site: Record<string, unknown>, building: Record<string, unknown>): ProjectInput {
  return {
    name: 'acc', country: 'IR', deterministic: true, seed: 42,
    site: { shape: 'rectangle', accessSide: 'south', streetWidth: 8, ...site },
    building: {
      type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
      kitchenType: 'closed', parkingSpaces: 1, hasStair: false, floors: 1, ...building,
    },
  } as ProjectInput;
}
const rect = (w: number, l: number, extra: Record<string, unknown> = {}) => ({ width: w, length: l, ...SB, ...extra });
const lsite = (w: number, l: number) => ({
  shape: 'l-shape', width: w, length: l,
  lShape: { width: w, length: l, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' },
});

function best(inp: ProjectInput): LayoutCandidate {
  const out = generate(createProject(inp), {});
  if (!out.bestCandidate) throw new Error('expected a feasible candidate');
  return out.bestCandidate;
}
const codes = (c: LayoutCandidate) => validateAccessibility(c).map(f => f.code);
/** Openings of `fl` whose host wall bounds the space `id`. */
const doorsOf = (fl: Floor, id: string) =>
  fl.openings.filter(o => (o.type === 'door' || o.type === 'sliding-door' || o.type === 'entrance')
    && (fl.walls.find(w => w.id === o.wallId)?.spaceIds ?? []).includes(id));

const TWO_F = input(rect(18, 25), { floors: 2, hasStair: true });
const TWO_F_LIFT = input(rect(18, 25), { floors: 2, hasStair: true, hasElevator: true });

describe('accessibility — status semantics and isolation', () => {
  it('every finding is advisory + REQUIRES_SOURCE_VERIFICATION with a reference; never HARD/soft', () => {
    for (const inp of [TWO_F, input(lsite(20, 24), { floors: 2, hasStair: true })]) {
      const f = validateAccessibility(best(inp));
      expect(f.length).toBeGreaterThan(0);
      for (const x of f) {
        expect(x.severity).toBe('advisory');
        expect(x.status).toBe('REQUIRES_SOURCE_VERIFICATION');
        expect(x.reference).toBeTruthy();
        expect(x.code.startsWith('ACC_')).toBe(true);
      }
    }
  });

  it('is standalone: candidate.findings and validateCandidate() carry no ACC_* finding', () => {
    const c = best(TWO_F);
    expect(validateAccessibility(c).length).toBeGreaterThan(0);
    expect(c.findings.some(f => f.code.startsWith('ACC_'))).toBe(false);
    expect(validateCandidate(c).findings.some(f => f.code.startsWith('ACC_'))).toBe(false);
  });

  it('is deterministic and does not mutate the candidate', () => {
    const c = best(input(lsite(20, 24), { floors: 2, hasStair: true }));
    const before = JSON.stringify(c);
    const a = validateAccessibility(c), b = validateAccessibility(c);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(c)).toBe(before);
    expect(JSON.stringify(validateAccessibility(best(input(lsite(20, 24), { floors: 2, hasStair: true }))))).toBe(JSON.stringify(a));
  });
});

describe('accessibility — ACC_FLOOR_NOT_STEP_FREE (stairs are never step-free)', () => {
  it('positive: single-floor plan has a full step-free route → no finding', () => {
    expect(validateAccessibility(best(input(rect(18, 25), {})))).toEqual([]);
  });

  it('negative: 2-floor plan without elevator flags floor 1 (stair present but not step-free)', () => {
    const c = best(TWO_F);
    expect(c.floors[1].stairs.length).toBeGreaterThan(0);
    const f = validateAccessibility(c).filter(x => x.code === 'ACC_FLOOR_NOT_STEP_FREE');
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('floor 1');
    expect(f[0].message).toContain('no elevator');
    expect(f[0].entityIds!.length).toBe(c.floors[1].spaces.filter(s => !['parking', 'yard', 'balcony'].includes(s.type)).length);
  });

  it('positive multi-floor: stacked elevator makes every floor step-free (2 and 4 floors)', () => {
    expect(validateAccessibility(best(TWO_F_LIFT))).toEqual([]);
    const c4 = best(input(rect(18, 25), { floors: 4, hasStair: true, hasElevator: true }));
    expect(validateAccessibility(c4)).toEqual([]);
    const { reached } = stepFreeReachable(c4);
    for (const fl of c4.floors) for (const s of fl.spaces) {
      if (!['parking', 'yard', 'balcony'].includes(s.type)) expect(reached.has(`${fl.level}\u0000${s.id}`)).toBe(true);
    }
  });

  it('negative: removing the ground-floor elevator landing door cuts every upper floor', () => {
    const c = structuredClone(best(TWO_F_LIFT));
    const g = c.floors[0];
    const hall = g.elevators[0].hallSpaceId;
    const drop = new Set(doorsOf(g, hall).map(o => o.id));
    expect(drop.size).toBeGreaterThan(0);
    g.openings = g.openings.filter(o => !drop.has(o.id));
    const f = validateAccessibility(c).filter(x => x.code === 'ACC_FLOOR_NOT_STEP_FREE');
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('landing');
  });

  it('negative: a shaft that is not exactly stacked is not a step-free link', () => {
    const c = structuredClone(best(TWO_F_LIFT));
    const e1 = c.floors[1].elevators[0];
    e1.rect = { ...e1.rect, x: e1.rect.x + 0.3 };
    expect(codes(c)).toContain('ACC_FLOOR_NOT_STEP_FREE');
  });
});

describe('accessibility — ACC_SPACE_NOT_STEP_FREE', () => {
  it('negative: a ground-floor room whose doors are removed is reported (and only it)', () => {
    const c = structuredClone(best(input(rect(18, 25), {})));
    const g = c.floors[0];
    const kitchen = g.spaces.find(s => s.type === 'kitchen')!;
    const drop = new Set(doorsOf(g, kitchen.id).map(o => o.id));
    g.openings = g.openings.filter(o => !drop.has(o.id));
    const f = validateAccessibility(c).filter(x => x.code === 'ACC_SPACE_NOT_STEP_FREE');
    expect(f.map(x => x.entityIds)).toEqual([[kitchen.id]]);
    expect(f[0].bbox).toEqual([kitchen.rect.x, kitchen.rect.y, kitchen.rect.x + kitchen.rect.w, kitchen.rect.y + kitchen.rect.h]);
  });
});

describe('accessibility — ACC_STEP_FREE_NO_ORIGIN (no false PASS)', () => {
  it('without a street entrance the result is UNDETERMINED, never an empty pass', () => {
    const c = structuredClone(best(input(rect(18, 25), {})));
    c.floors[0].openings = c.floors[0].openings.filter(o => o.type !== 'entrance');
    const f = validateAccessibility(c);
    expect(f.map(x => x.code)).toEqual(['ACC_STEP_FREE_NO_ORIGIN']);
    expect(f[0].message).toContain('UNDETERMINED');
  });
});

describe('accessibility — ACC_ACCESSIBLE_SANITARY_ABSENT (verified dimension, unverified applicability)', () => {
  const room007 = () => IR_NATIONAL_MBR_PACK.rules.find(r => r.ruleId === 'MBH4-ROOM-007')!;
  /** Temporarily edit ROOM-007 metadata; always restored. */
  function withRoom007(edit: (t: Record<string, { value: number; unit: string; note?: string }>) => void, body: () => void) {
    const t = room007().thresholds!;
    const saved = structuredClone(t);
    try { edit(t); body(); } finally {
      for (const k of Object.keys(t)) delete t[k];
      Object.assign(t, saved);
    }
  }

  it('footprint and source are read from MBH4-ROOM-007 pack metadata (§4-5-6-2-1, PDF p75)', () => {
    const rule = room007();
    expect(rule.status).toBe('VERIFIED');
    expect(rule.thresholds!.accessible_sanitary_long).toMatchObject({ value: 1.7, unit: 'm' });
    expect(rule.thresholds!.accessible_sanitary_short).toMatchObject({ value: 1.5, unit: 'm' });
    expect(rule.thresholds!.accessible_sanitary_long.note).toContain('§4-5-6-2-1 — PDF p75');
    const fp = accessibleSanitaryFootprint()!;
    expect([fp.long, fp.short]).toEqual([rule.thresholds!.accessible_sanitary_long.value, rule.thresholds!.accessible_sanitary_short.value]);
    // the p75 source object carried by ROOM-007 itself (no copy)
    expect(fp.sources).toHaveLength(1);
    expect(fp.sources[0]).toBe(rule.sources!.find(x => x.page === 75));
  });

  it('the validator follows the ROOM-007 metadata (no local copy of the value)', () => {
    const c = best(TWO_F); // ground guest-wc 1.90×2.10 passes with 1.70×1.50
    expect(codes(c)).not.toContain('ACC_ACCESSIBLE_SANITARY_ABSENT');
    withRoom007(t => { t.accessible_sanitary_short = { ...t.accessible_sanitary_short, value: 2.5 }; }, () => {
      const f = validateAccessibility(c).find(x => x.code === 'ACC_ACCESSIBLE_SANITARY_ABSENT')!;
      expect(f).toBeTruthy();
      expect(f.message).toContain('1.70×2.50 m');
      expect(f.reference).toContain('1.70×2.50 m');
    });
    expect(codes(c)).not.toContain('ACC_ACCESSIBLE_SANITARY_ABSENT');
  });

  it('missing ROOM-007 metadata is an explicit error, never a silent skip', () => {
    const c = best(TWO_F);
    withRoom007(t => { delete (t as Record<string, unknown>).accessible_sanitary_long; }, () => {
      expect(accessibleSanitaryFootprint()).toBeNull();
      expect(() => validateAccessibility(c)).toThrow(/MBH4-ROOM-007/);
    });
  });

  it('the new metadata does not change ROOM-007 enforcement (1.00×1.30 m, evaluator unchanged)', () => {
    const rule = room007();
    expect(rule.thresholds!.min_width.value).toBe(1.0);
    expect(rule.thresholds!.min_length.value).toBe(1.3);
    const c = structuredClone(best(TWO_F));
    const wc = c.floors[0].spaces.find(s => s.type === 'guest-wc')!;
    wc.rect = { ...wc.rect, w: 0.95 }; // below 1.00 → ROOM-007 HARD
    const run = () => JSON.stringify((rule.evaluate as Function)({ project: { building: { floors: 2, type: 'villa' } }, candidate: c }));
    const base = run();
    expect(base).toContain('MBH4-ROOM-007');
    withRoom007(t => { t.accessible_sanitary_long = { ...t.accessible_sanitary_long, value: 9 }; t.accessible_sanitary_short = { ...t.accessible_sanitary_short, value: 9 }; }, () => {
      expect(run()).toBe(base);
    });
  });

  it('positive: a step-free-reachable sanitary space ≥1.70×1.50 → no finding', () => {
    const c = best(TWO_F);
    const wc = c.floors[0].spaces.find(s => s.type === 'guest-wc')!;
    expect(Math.min(wc.rect.w, wc.rect.h)).toBeGreaterThanOrEqual(1.5);
    expect(codes(c)).not.toContain('ACC_ACCESSIBLE_SANITARY_ABSENT');
  });

  it('negative: shrinking the only reachable sanitary space below 1.50 m fires, citing the p75 source', () => {
    const c = structuredClone(best(TWO_F));
    const wc = c.floors[0].spaces.find(s => s.type === 'guest-wc')!;
    wc.rect = { ...wc.rect, w: 1.4 };
    const f = validateAccessibility(c).find(x => x.code === 'ACC_ACCESSIBLE_SANITARY_ABSENT')!;
    expect(f).toBeTruthy();
    expect(f.severity).toBe('advisory');
    expect(f.status).toBe('REQUIRES_SOURCE_VERIFICATION');
    expect(f.reference).toContain('§4-5-6-2-1');
    expect(f.sources?.[0]).toMatchObject({ sourceId: 't1-mabhas4-96-pdf', page: 75 });
    expect(f.message).toContain('not verified');
  });

  it('negative: a large bathroom only on an upper floor without a lift does not count', () => {
    const c = structuredClone(best(TWO_F));
    c.floors[0].spaces = c.floors[0].spaces.map(s => (s.type === 'guest-wc' ? { ...s, rect: { ...s.rect, w: 1.2 } } : s));
    expect(c.floors[1].spaces.some(s => s.type === 'master-bathroom')).toBe(true);
    expect(codes(c)).toContain('ACC_ACCESSIBLE_SANITARY_ABSENT');
  });
});

describe('accessibility — narrow, asymmetric and L-shaped sites', () => {
  it('narrow 8×25 single floor: full step-free route, no finding', () => {
    const c = best(input({ width: 8, length: 25, setbackNorth: 2, setbackSouth: 1, setbackEast: 0, setbackWest: 0 }, { bedrooms: 1, parkingSpaces: 0 }));
    expect(validateAccessibility(c)).toEqual([]);
  });

  it('asymmetric east-access 18×25 2F: only the upper floor is flagged', () => {
    const c = best(input(rect(18, 25, { accessSide: 'east', setbackNorth: 4, setbackSouth: 1, setbackEast: 4, setbackWest: 0.5 }), { floors: 2, hasStair: true }));
    expect(validateAccessibility(c).map(f => [f.code, (f as { value?: number }).value])).toEqual([['ACC_FLOOR_NOT_STEP_FREE', 1]]);
  });

  it('L-shape: no lift → upper floor flagged; stacked lift → fully step-free', () => {
    expect(codes(best(input(lsite(20, 24), { floors: 2, hasStair: true })))).toEqual(['ACC_FLOOR_NOT_STEP_FREE']);
    expect(validateAccessibility(best(input(lsite(20, 26), { floors: 2, hasStair: true, hasElevator: true })))).toEqual([]);
  });
});
