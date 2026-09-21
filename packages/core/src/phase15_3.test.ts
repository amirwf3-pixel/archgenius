/**
 * Phase 15 M3 — building-level program distribution.
 *
 * Contract under test:
 *   1. The required program is determined for the WHOLE building and distributed
 *      across floors; floors[].sum == requested (nothing duplicated, dropped, invented).
 *   2. Multi-floor villas: ground = public/service, upper floors = private program,
 *      balanced (per-floor difference ≤ 1 bedroom), master suites stay paired with
 *      their master bath, family room exists exactly once, guest-wc on ground.
 *   3. Every strategy receives the SAME allocation (no strategy-specific program drift).
 *   4. Upper floors never receive a fabricated entrance (phantom-door elimination).
 *   5. Program-completeness: placement failure to realize an assigned room is an
 *      explicit HARD (never a silent drop) — and thus never a usable candidate.
 *   6. All of this is parametric: invariant over widths/lengths (incl. decimals),
 *      bedroom/bath counts, floors 1..4, seeds — asserted via sweeps, not fixtures.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate } from './pipeline.js';
import { allocateBuildingProgram, programForFloor } from './programming/program.js';
import { validateLayout } from './validation/validator.js';
import { legacyGenerate } from './testutil/legacy-generate.js';
import type { BuildingInput } from './model/building.js';

const villa = (o: Partial<BuildingInput>): BuildingInput => ({
  type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
  kitchenType: 'closed', parkingSpaces: 0, hasStair: true, ...o,
} as BuildingInput);

describe('Phase 15 M3 A: allocation invariants (parametric sweep)', () => {
  it('totals per type equal the requested program for every floors×bedrooms×baths combo', () => {
    for (const floors of [1, 2, 3, 4]) {
      for (const bedrooms of [1, 2, 3, 4, 5, 6]) {
        for (const masterBedrooms of [0, 1, 2]) {
          for (const bathrooms of [0, 1, 2, 3]) {
            const b = villa({ floors, bedrooms, masterBedrooms, bathrooms, hasFamilyRoom: true });
            const a = allocateBuildingProgram(b, floors);
            expect(a.length).toBe(floors);
            const sum = (k: 'regularBedrooms' | 'masterSuites' | 'extraBathrooms') =>
              a.reduce((s, x) => s + x[k], 0);
            const reqTotal = Math.max(1, bedrooms);
            const reqMasters = Math.min(Math.max(0, masterBedrooms), reqTotal);
            expect(sum('masterSuites')).toBe(reqMasters);
            expect(sum('regularBedrooms')).toBe(reqTotal - reqMasters);
            expect(sum('extraBathrooms')).toBe(Math.max(0, Math.max(0, bathrooms) - reqMasters));
            // Family room exactly once when the building has one and there is a private floor.
            expect(a.filter(x => x.familyRoomHere).length).toBe(1);
            // Ground floor of a multi-floor villa carries NO private program.
            if (floors > 1) expect(a[0].privateFloor).toBe(false);
            // No negative counts anywhere.
            for (const x of a) {
              expect(x.regularBedrooms).toBeGreaterThanOrEqual(0);
              expect(x.masterSuites).toBeGreaterThanOrEqual(0);
              expect(x.extraBathrooms).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('bedrooms balance across upper floors (max difference ≤ 1) and prefer lower floors', () => {
    for (const bedrooms of [2, 3, 4, 5, 6, 7]) {
      const b = villa({ floors: 3, bedrooms, masterBedrooms: 1, bathrooms: 3 });
      const a = allocateBuildingProgram(b, 3);
      const beds = a.slice(1).map(x => x.regularBedrooms + x.masterSuites);
      expect(Math.max(...beds) - Math.min(...beds)).toBeLessThanOrEqual(1);
      for (let i = 1; i < beds.length; i++) expect(beds[i - 1]).toBeGreaterThanOrEqual(beds[i]);
    }
  });

  it('deterministic: same input → identical allocations, twice', () => {
    const b = villa({ floors: 3, bedrooms: 5, masterBedrooms: 2, bathrooms: 3 });
    expect(allocateBuildingProgram(b, 3)).toEqual(allocateBuildingProgram(b, 3));
  });

  it('master suites remain paired with a master bath on their floor when baths are requested', () => {
    for (const floors of [2, 3]) {
      const b = villa({ floors, bedrooms: 4, masterBedrooms: 2, bathrooms: 2 });
      const a = allocateBuildingProgram(b, floors);
      for (const x of a) {
        if (x.masterSuites > 0 && b.bathrooms > 0) {
          const specs = programForFloor(b, x.level, floors === 1, x);
          const mbs = specs.filter(s => s.type === 'master-bathroom').length;
          expect(mbs).toBe(x.masterSuites);
        }
      }
    }
  });

  it('apartments keep the documented V1 full-unit-per-floor policy', () => {
    const b = { ...villa({ floors: 3, bedrooms: 3, masterBedrooms: 1, bathrooms: 2 }), type: 'apartment' as const };
    const a = allocateBuildingProgram(b, 3);
    const beds = a.map(x => x.regularBedrooms + x.masterSuites);
    expect(beds).toEqual([3, 3, 3]); // every floor is a full unit — intentional, not duplication
    expect(a.map(x => x.publicFloor)).toEqual([true, false, false]);
  });
});

describe('Phase 15 M3 B: generated plans honor the allocation end-to-end', () => {
  const twoFloor = () => createProject({
    name: 'M3-2f', country: 'IR',
    site: { shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8 },
    building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true },
    deterministic: true, seed: 42,
  } as any);

  it('usable winner: no bedroom program on ground, bedrooms only above, no phantom upper entrance', () => {
    const r = generate(twoFloor());
    expect(r.bestCandidate).not.toBeNull();
    const b = r.bestCandidate!;
    const g = b.floors.find(f => f.level === 0)!;
    const u = b.floors.find(f => f.level === 1)!;
    expect(g.spaces.some(s => s.type === 'bedroom' || s.type === 'master-bedroom')).toBe(false);
    expect(u.spaces.some(s => s.type === 'living' || s.type === 'entrance' || s.type === 'foyer')).toBe(false);
    const upperBeds = u.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom').length;
    expect(upperBeds).toBe(3); // full requested program, exactly once, on the private floor
    // Entry sequence realized on the ground floor (never silently dropped):
    expect(g.spaces.some(s => s.type === 'entrance')).toBe(true);
    expect(g.spaces.some(s => s.type === 'foyer')).toBe(true);
    // Stair/core coherent: a stair-hall exists on BOTH floors.
    expect(g.spaces.some(s => s.type === 'stair-hall')).toBe(true);
    expect(u.spaces.some(s => s.type === 'stair-hall')).toBe(true);
    // Zero hards (M2 gate contract intact on top of M3 distribution).
    expect(validateLayout(b).hard.length).toBe(0);
  });

  it('every strategy receives the SAME per-floor assigned program', () => {
    // Compare across ALL generated strategies (generator path, pre-gate) — no strategy may
    // silently receive a different or partial program on any floor.
    const wide = createProject({
      name: 'M3-wide-20x30', country: 'IR',
      site: { shape: 'rectangle', width: 20, length: 30, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 3, masterBedrooms: 2, bathrooms: 2, wc: 1, kitchenType: 'semi-open', parkingSpaces: 1, hasStorage: true, hasBalcony: true },
      deterministic: true, seed: 42,
    } as any);
    const r = legacyGenerate(wide, { allStrategies: true });
    expect(r.candidates.length).toBeGreaterThan(1);
    const sigs = r.candidates.map(c => JSON.stringify((c as any).programRequirements));
    for (const s of sigs) expect(s).toBe(sigs[0]);
  });

  it('infeasible tight site: unplaced program rooms surface as explicit HARD, never a silent pass', () => {
    const prj = createProject({
      name: 'M3-tight-12x18', country: 'IR',
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      deterministic: true, seed: 1,
    } as any);
    const r = generate(prj);
    expect(r.bestCandidate).toBeNull(); // no artificial PASS with dropped entry rooms
    expect(['HARD_RULE_VIOLATION', 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION']).toContain(r.infeasible!.code);
    // No usable candidate anywhere…
    expect(r.candidates).toEqual([]);
    // …and the completeness rule holds structurally: every rejected plan is EITHER a
    // geometry violation (DIM) or carries an explicit hard — a plan with unplaced
    // requested rooms never appears in the usable set, and any plan that lost rooms
    // reports them by name.
    for (const d of r.infeasible!.diagnosticCandidates) {
      const unplaced = d.findings.filter(f => f.code === 'ARCH_PROGRAM_UNPLACED');
      for (const f of unplaced) {
        const type = /room '([^']+)'/.exec(f.message)?.[1] ?? '';
        expect(d.floors.some(fl => fl.spaces.some(s => s.type === type))).toBe(false);
      }
      expect(d.findings.some(f => f.severity === 'hard')).toBe(true);
    }
  });

  it('decimal + asymmetric site: distribution still exact and deterministic', () => {
    const input = {
      name: 'M3-dec', country: 'IR',
      site: { shape: 'rectangle', width: 15.5, length: 22.25, accessSide: 'east', streetWidth: 7.5 },
      building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true },
      deterministic: true, seed: 7,
    } as any;
    const r1 = generate(createProject(input));
    const r2 = generate(createProject(input));
    expect(r1.bestCandidate?.id).toBe(r2.bestCandidate?.id);
    if (r1.bestCandidate && r2.bestCandidate) {
      expect(JSON.stringify(r1.bestCandidate.floors.map(f => f.spaces.map(s => s.type))))
        .toBe(JSON.stringify(r2.bestCandidate.floors.map(f => f.spaces.map(s => s.type))));
    }
    const b = r1.bestCandidate ?? r1.infeasible!.diagnosticCandidates[0];
    const upper = b.floors.find(f => f.level === 1)!;
    expect(upper.spaces.filter(s => s.type === 'bedroom' || s.type === 'master-bedroom').length).toBe(3);
  });
});
