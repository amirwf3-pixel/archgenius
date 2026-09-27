/**
 * Upper-floor private programme — default Phase 5.6A split (12×18 diagnosis).
 *
 * On an upper floor with no public programme the band in front of the corridor is an
 * intentional void. When the private band behind the corridor fails the M6 capacity
 * check, the legacy path dropped every private room (ARCH_PROGRAM_UNPLACED). The
 * production `generate()` path now enables the existing, validator-guarded Phase 5.6A
 * split by default, so the trailing private clusters use that empty band instead.
 *
 * With 2 parking the 12×18 / 2-floor / 3-bedroom / south-access input is now solved by the
 * guarded parking-cutout fallback (no normal candidate is valid, the parking corner is cut
 * out of the buildable rect): VALID, zero HARD, every programme space and both stalls
 * placed — with or without the 5.6A option. The 5.6A split itself stays pinned by the
 * parking-free suite below.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { getTypicalArea } from './programming/program.js';
import { hasOverlappingRooms } from './layout/placer.js';
import type { ProjectInput } from './model/project.js';
import type { LayoutCandidate } from './model/layout.js';
import { PARKING_CUTOUT_APPLIED } from './generator/generator.js';

const input = (parkingSpaces: number): ProjectInput => ({
  name: '12x18 upper-floor regression',
  jurisdiction: 'IR',
  seed: 424242,
  deterministic: true,
  site: {
    shape: 'rectangle', width: 12, length: 18, streetWidth: 8, accessSide: 'south',
    setbackNorth: 1.5, setbackSouth: 3, setbackEast: 1.5, setbackWest: 1.5,
  },
  building: {
    type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
    kitchenType: 'closed', parkingSpaces, hasStair: true, hasStorage: true,
  },
} as unknown as ProjectInput);

const run = (parkingSpaces: number, opts: { upperFloorFrontPrivate?: boolean } = {}) =>
  generate(createProject(JSON.parse(JSON.stringify(input(parkingSpaces)))), { allStrategies: true, ...opts });

/** Every candidate the engine produced (usable ones, or the diagnostic ones when infeasible). */
const allCandidates = (r: ReturnType<typeof run>): LayoutCandidate[] =>
  r.bestCandidate ? r.candidates : (r.infeasible?.diagnosticCandidates ?? []);

const byStrategy = (r: ReturnType<typeof run>, s: string) =>
  allCandidates(r).find(c => c.metadata.strategy === s);

/** Requested upper-floor private programme for this input. */
const UPPER_PROGRAM: Record<string, number> = { 'master-bedroom': 1, 'master-bathroom': 1, 'bedroom': 2, 'bathroom': 1 };

/** Buildable rectangle derived from the input (site minus setbacks). */
const BUILDABLE = (() => {
  const s = input(0).site as unknown as { width: number; length: number; setbackNorth: number; setbackSouth: number; setbackEast: number; setbackWest: number };
  return { x0: s.setbackWest, y0: s.setbackSouth, x1: s.width - s.setbackEast, y1: s.length - s.setbackNorth };
})();

const rectOf = (poly: Array<{ x: number; y: number }>) => {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

const upperPrivate = (c: LayoutCandidate) =>
  c.floors[1].spaces.filter(s => Object.prototype.hasOwnProperty.call(UPPER_PROGRAM, s.type));

const unplacedUpper = (c: LayoutCandidate) =>
  validateCandidate(c).findings.filter(f => f.severity === 'hard' && f.code === 'ARCH_PROGRAM_UNPLACED' && /^Floor 1:/.test(f.message));

const content = (c: LayoutCandidate) => JSON.stringify({ floors: c.floors, findings: c.findings, explanations: c.explanations });

const SPLIT_STRATEGIES = ['functional-circulation', 'alternative-zoning'] as const;

describe('12×18 2F 3-bed 2-parking: upper-floor private rooms use the empty front band (default)', () => {
  const r = run(2);

  for (const s of SPLIT_STRATEGIES) {
    it(`${s}: every requested upper-floor bedroom / bathroom is placed`, () => {
      const c = byStrategy(r, s)!;
      expect(c).toBeDefined();
      const counts: Record<string, number> = {};
      for (const sp of upperPrivate(c)) counts[sp.type] = (counts[sp.type] ?? 0) + 1;
      expect(counts).toEqual(UPPER_PROGRAM);
      expect(unplacedUpper(c)).toEqual([]);
      expect(c.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED))).toBe(true);
    });

    it(`${s}: programme minimum area and width are kept`, () => {
      const c = byStrategy(r, s)!;
      for (const sp of upperPrivate(c)) {
        const prof = getTypicalArea(sp.type);
        const b = rectOf(sp.polygon);
        expect(sp.area, `${sp.id} area`).toBeGreaterThanOrEqual(prof.min - 1e-6);
        expect(Math.min(b.x1 - b.x0, b.y1 - b.y0), `${sp.id} min side`).toBeGreaterThanOrEqual((prof.minWidth ?? 0) - 1e-6);
      }
    });

    it(`${s}: no overlaps on the changed floor, ground floor untouched, nothing outside the buildable area`, () => {
      const c = byStrategy(r, s)!;
      // The split only rebuilds the upper floor; the ground floor must equal the legacy one
      // (any pre-existing ground-floor finding is unchanged, not introduced here).
      const legacy = byStrategy(run(2, { upperFloorFrontPrivate: false }), s)!;
      expect(JSON.stringify(c.floors[0].spaces)).toBe(JSON.stringify(legacy.floors[0].spaces));
      expect(hasOverlappingRooms(c.floors[1].spaces), 'upper floor overlap').toBe(false);
      const upperIds = new Set(c.floors[1].spaces.map(sp => sp.id));
      const hard = validateCandidate(c).findings.filter(f => f.severity === 'hard');
      expect(hard.filter(f => /OVERLAP/.test(f.code) && (f.entityIds ?? []).some(id => upperIds.has(id)))).toEqual([]);
      for (const fl of c.floors) {
        for (const sp of fl.spaces) {
          const b = rectOf(sp.polygon);
          expect(b.x0).toBeGreaterThanOrEqual(BUILDABLE.x0 - 1e-6);
          expect(b.y0).toBeGreaterThanOrEqual(BUILDABLE.y0 - 1e-6);
          expect(b.x1).toBeLessThanOrEqual(BUILDABLE.x1 + 1e-6);
          expect(b.y1).toBeLessThanOrEqual(BUILDABLE.y1 + 1e-6);
        }
      }
      const codes = validateCandidate(c).findings.filter(f => f.severity === 'hard').map(f => f.code);
      expect(codes).not.toContain('SITE_WALL_OUTSIDE_BUILDABLE');
    });
  }

  it('the input is feasible: valid best candidate, zero HARD, parking and every programme space placed', () => {
    expect(r.bestCandidate).not.toBeNull();
    expect(r.infeasible ?? null).toBeNull();
    const c = r.bestCandidate!;
    expect(c.valid).toBe(true);
    const findings = validateCandidate(c).findings;
    expect(findings.filter(f => f.severity === 'hard')).toEqual([]);
    expect(findings.some(f => f.code === 'PARKING_PROGRAM_UNPLACED')).toBe(false);
    expect(findings.some(f => f.code === 'ARCH_PROGRAM_UNPLACED')).toBe(false);
    expect(c.floors[0].parkingStalls).toHaveLength(2);
    for (const req of c.programRequirements ?? []) {
      const got: Record<string, number> = {};
      for (const sp of c.floors[req.level].spaces) got[sp.type] = (got[sp.type] ?? 0) + 1;
      for (const [t, n] of Object.entries(req.byType)) expect(got[t] ?? 0, `floor ${req.level} ${t}`).toBeGreaterThanOrEqual(n as number);
    }
  });

  it('deterministic: repeated generation is identical', () => {
    const again = run(2);
    const a = allCandidates(r), b = allCandidates(again);
    expect(b.map(c => c.metadata.strategy)).toEqual(a.map(c => c.metadata.strategy));
    a.forEach((c, i) => expect(content(b[i])).toBe(content(c)));
  });

  it('explicit upperFloorFrontPrivate: false — no 5.6A split, the same guarded cutout fallback places the upper rooms', () => {
    const legacy = run(2, { upperFloorFrontPrivate: false });
    for (const s of SPLIT_STRATEGIES) {
      const c = byStrategy(legacy, s)!;
      expect(c.explanations.some(e => e.startsWith('Phase 5.6A: upper-floor front private split adopted'))).toBe(false);
      expect(c.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED))).toBe(true);
      expect(unplacedUpper(c)).toEqual([]);
      expect(c.valid).toBe(true);
    }
  });
});

describe('same site without parking: the upper-floor fix alone makes the input feasible', () => {
  it('a HARD-clean plan with the complete upper-floor programme is produced', () => {
    const r = run(0);
    expect(r.bestCandidate).not.toBeNull();
    const c = r.bestCandidate!;
    expect(validateCandidate(c).findings.filter(f => f.severity === 'hard')).toEqual([]);
    const counts: Record<string, number> = {};
    for (const sp of upperPrivate(c)) counts[sp.type] = (counts[sp.type] ?? 0) + 1;
    expect(counts).toEqual(UPPER_PROGRAM);
  });

  it('legacy (false) is INFEASIBLE for the same input', () => {
    expect(run(0, { upperFloorFrontPrivate: false }).bestCandidate).toBeNull();
  });
});
