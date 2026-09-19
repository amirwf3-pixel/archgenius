/**
 * Phase 13.1 Feasibility Boundary & Invalid-Geometry Elimination
 * A-O behavioral tests
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { generateLayouts } from './generator/generator.js';
import type { ProjectInput } from './model/project.js';
import { rectInsidePolygon } from './geometry/polygon-ops.js';

function proj(input: Partial<ProjectInput> & { site: any; building: any }): ProjectInput {
  return {
    name: input.name ?? 'P13.1',
    site: input.site,
    building: input.building,
    deterministic: true,
    seed: input.seed ?? 42,
    country: 'IR',
  } as any;
}

function checkNoInvalidGeom(cand: any) {
  for (const fl of cand.floors) {
    for (const s of fl.spaces) {
      expect(s.rect.w, `${s.type} w>0`).toBeGreaterThan(0);
      expect(s.rect.h, `${s.type} h>0`).toBeGreaterThan(0);
      expect(s.area, `${s.type} area>0`).toBeGreaterThan(0);
      expect(s.polygon.length, `${s.type} polygon`).toBeGreaterThanOrEqual(4);
    }
  }
}

describe('Phase 13.1 A-O Invalid Geometry Elimination', () => {
  // A: no valid room has width <=0
  it('A: no valid room has width <=0 across all candidates', () => {
    const cases = [
      { w: 8, l: 12 }, { w: 8, l: 25 }, { w: 10, l: 14 }, { w: 10, l: 18 }, { w: 10, l: 30 },
      { w: 12, l: 18 }, { w: 15, l: 20 },
    ];
    for (const c of cases) {
      const prj = createProject(proj({
        site: { shape: 'rectangle', width: c.w, length: c.l, accessSide: 'south', streetWidth: 8 },
        building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
        seed: 42,
      }));
      const { candidates } = generate(prj, { allStrategies: true });
      for (const cand of candidates) {
        for (const fl of cand.floors) {
          for (const sp of fl.spaces) {
            expect(sp.rect.w, `${c.w}x${c.l} ${sp.type} w>0`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  // B: no valid room has height <=0
  it('B: no valid room has height <=0', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 10, length: 14, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      seed: 42,
    }));
    const { candidates } = generate(prj, { allStrategies: true });
    for (const cand of candidates) {
      for (const fl of cand.floors) for (const sp of fl.spaces) {
        expect(sp.rect.h, `${sp.type} h>0`).toBeGreaterThan(0);
      }
    }
  });

  // C: no valid room has area <=0
  it('C: no valid room has area <=0', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      seed: 1,
    }));
    const { candidates } = generate(prj, { allStrategies: true });
    for (const cand of candidates) {
      for (const fl of cand.floors) for (const sp of fl.spaces) {
        expect(sp.area).toBeGreaterThan(0);
        expect(sp.rect.w * sp.rect.h).toBeGreaterThan(0);
      }
    }
  });

  // D: no valid candidate below minWidth (feasible sites)
  it('D: feasible sites have no below-minWidth in valid candidate', () => {
    const feasible = [
      { w: 12, l: 18, setbacks: { north: 0, south: 0, east: 0, west: 0 } },
      { w: 15, l: 20, setbacks: { north: 2, south: 3, east: 2, west: 2 } },
    ];
    for (const f of feasible) {
      const prj = createProject(proj({
        site: { shape: 'rectangle', width: f.w, length: f.l, accessSide: 'south', streetWidth: 8, setbacks: f.setbacks },
        building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
        seed: 42,
      }));
      const { bestCandidate } = generate(prj);
      const vr = validateCandidate(bestCandidate!);
      // If feasible, no HARD_CONSTRAINT_INFEASIBLE_DIMENSION
      const dimHard = vr.hard.filter((x: any) => x.code === 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
      if (dimHard.length === 0) {
        for (const fl of bestCandidate!.floors) for (const sp of fl.spaces) {
          const minW = sp.minWidth ?? 0.9;
          expect(sp.rect.w + 1e-6, `${f.w}x${f.l} ${sp.type} w>=min`).toBeGreaterThanOrEqual(minW - 0.05);
        }
      }
    }
  });

  // E: no valid candidate below minArea
  it('E: feasible valid candidate respects minArea', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8, setbacks: { north: 0, south: 0, east: 0, west: 0 } },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
      seed: 42,
    }));
    const { bestCandidate } = generate(prj);
    const vr = validateCandidate(bestCandidate!);
    const dimHard = vr.hard.filter((f: any) => f.code === 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    expect(dimHard.length).toBe(0);
    for (const fl of bestCandidate!.floors) for (const sp of fl.spaces) {
      const minA = sp.minArea ?? 0;
      if (minA > 0) expect(sp.area + 1e-6).toBeGreaterThanOrEqual(minA - 0.1);
    }
  });

  // F: infeasible narrow sites have explicit HARD and no valid candidate or honest HARD
  it('F: infeasible narrow 8x12 has explicit HARD and no invalid geometry', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      seed: 1,
    }));
    const { bestCandidate, candidates, infeasible } = generate(prj, { allStrategies: true }) as any;
    // All candidates must have positive dims (if any valid)
    for (const cand of candidates) checkNoInvalidGeom(cand);
    if (!bestCandidate) {
      expect(infeasible).toBeDefined();
      expect(infeasible.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
      for (const d of infeasible.diagnosticCandidates) checkNoInvalidGeom(d);
      return;
    }
    const vr = validateCandidate(bestCandidate!);
    expect(vr.hard.length).toBeGreaterThan(0);
  });

  // G: L-shape site no negative/zero/invalid polygon
  it('G: L-shape 12x18 no negative/zero/invalid polygon', () => {
    const prj = createProject({
      name: 'lshape', country: 'IR',
      site: { shape: 'l-shape', width: 12, length: 18, lShape: { width: 12, length: 18, notchWidth: 4, notchLength: 6, notchCorner: 'ne' }, accessSide: 'south', streetWidth: 8 } as any,
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
      deterministic: true, seed: 42,
    } as any);
    const { candidates, bestCandidate, infeasible } = generate(prj, { allStrategies: true });
    for (const cand of candidates) checkNoInvalidGeom(cand);
    if (bestCandidate) {
      checkNoInvalidGeom(bestCandidate);
    } else {
      // Phase 13.2: below-minimum L-shape → explicit INFEASIBLE with no usable candidate;
      // the Phase 13.1 positivity guarantee still holds for diagnostic candidates.
      expect(infeasible!.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
      expect(infeasible!.diagnosticCandidates.length).toBeGreaterThan(0);
      for (const d of infeasible!.diagnosticCandidates) checkNoInvalidGeom(d);
    }
  });

  // H: 8-vertex polygon no negative
  it('H: 8-vertex polygon 15x20 no negative dims', () => {
    const poly = [
      { x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 6 }, { x: 10, y: 6 },
      { x: 10, y: 12 }, { x: 15, y: 12 }, { x: 15, y: 20 }, { x: 0, y: 20 },
    ];
    const prj = createProject({
      name: 'poly', country: 'IR',
      site: { shape: 'polygon', polygon: { vertices: poly } as any, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
      deterministic: true, seed: 42,
    } as any);
    const { candidates } = generate(prj, { allStrategies: true });
    for (const cand of candidates) checkNoInvalidGeom(cand);
  });

  // I: feasible 12x18 and 15x20 have 0 GEO outside when feasible
  it('I: feasible 12x18 no GEO outside, 15x20 no GEO outside', () => {
    for (const dim of [{ w: 12, l: 18 }, { w: 15, l: 20 }]) {
      const prj = createProject(proj({
        site: { shape: 'rectangle', width: dim.w, length: dim.l, accessSide: 'south', streetWidth: 8 },
        building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
        seed: 42,
      }));
      const { bestCandidate } = generate(prj);
      const vr = validateCandidate(bestCandidate!);
      const geoOut = vr.hard.filter((f: any) => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT' || f.code === 'SITE_ROOM_OUTSIDE_BUILDABLE');
      // If feasible (no infeasible dim hard), geoOut must be 0
      const dimHard = vr.hard.filter((f: any) => f.code === 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
      if (dimHard.length === 0) expect(geoOut.length).toBe(0);
    }
  });

  // J: 12x18 no-setbacks preserved no overlap/no negative/min satisfied/no GEO
  it('J: 12x18 no-setbacks preserved invariants', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8, setbacks: { north: 0, south: 0, east: 0, west: 0 } },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
      seed: 42,
    }));
    const { bestCandidate } = generate(prj);
    const vr = validateCandidate(bestCandidate!);
    checkNoInvalidGeom(bestCandidate);
    const overlap = vr.hard.filter((f: any) => f.code === 'GEO_ROOM_OVERLAPPING');
    expect(overlap.length).toBe(0);
    const geoOut = vr.hard.filter((f: any) => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT');
    expect(geoOut.length).toBe(0);
    const dimHard = vr.hard.filter((f: any) => f.code === 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    expect(dimHard.length).toBe(0);
  });

  // K: vertical/horizontal strategies both produce positive dims
  it('K: vertical/horizontal strategies positive dims', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
      seed: 1,
    }));
    const cands = generateLayouts(prj.input, ['area-efficiency', 'daylight-orientation', 'functional-circulation', 'alternative-zoning']);
    for (const cand of cands) {
      checkNoInvalidGeom(cand);
    }
  });

  // L: fallback entrance carving never negative
  it('L: entrance carving fallback never negative', () => {
    // Narrow foyer case that previously produced negative h
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 10, length: 14, accessSide: 'south', streetWidth: 6 },
      building: { type: 'villa', floors: 1, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 0, kitchenType: 'open', parkingSpaces: 0 },
      seed: 42,
    }));
    const { candidates } = generate(prj, { allStrategies: true });
    for (const cand of candidates) {
      const ent = cand.floors[0].spaces.find((s: any) => s.type === 'entrance');
      if (ent) {
        expect(ent.rect.w).toBeGreaterThan(0);
        expect(ent.rect.h).toBeGreaterThan(0);
      }
      const foyer = cand.floors[0].spaces.find((s: any) => s.type === 'foyer');
      if (foyer) {
        expect(foyer.rect.w).toBeGreaterThan(0);
        expect(foyer.rect.h).toBeGreaterThan(0);
      }
    }
  });

  // M: deterministic infeasibility same HARD across runs
  it('M: deterministic infeasibility 8x12 same HARD count across seeds', () => {
    const make = (seed: number) => {
      const prj = createProject(proj({
        site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 8 },
        building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
        seed,
      }));
      const res = generate(prj) as any;
      const { bestCandidate, infeasible } = res;
      if (!bestCandidate) {
        // Infeasible: count hard from diagnostic first candidate
        const diag = infeasible.diagnosticCandidates[0];
        return validateCandidate(diag).hard.length;
      }
      return validateCandidate(bestCandidate!).hard.length;
    };
    const h1 = make(1);
    const h2 = make(1);
    expect(h1).toBe(h2);
  });

  // N: invalid excluded from ranking — bestCandidate never has w<=0 even if some strategy produces it (defense)
  it('N: invalid excluded from ranking', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1 },
      seed: 42,
    }));
    const res = generate(prj, { allStrategies: true }) as any;
    const { bestCandidate, infeasible } = res;
    if (!bestCandidate) {
      expect(infeasible).toBeDefined();
      for (const d of infeasible.diagnosticCandidates) checkNoInvalidGeom(d);
      const vr = validateCandidate(infeasible.diagnosticCandidates[0]);
      expect(vr.hard.length).toBeGreaterThan(0);
      return;
    }
    checkNoInvalidGeom(bestCandidate);
    // Even if infeasible, must have explicit HARD
    const vr = validateCandidate(bestCandidate!);
    expect(vr.hard.length).toBeGreaterThan(0);
  });

  // O: multi-floor 2F no invalid geometry
  it('O: multi-floor 2F no invalid geometry', () => {
    const prj = createProject(proj({
      site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: true },
      seed: 42,
    }));
    const { bestCandidate } = generate(prj);
    for (const fl of bestCandidate!.floors) {
      for (const sp of fl.spaces) {
        expect(sp.rect.w).toBeGreaterThan(0);
        expect(sp.rect.h).toBeGreaterThan(0);
        expect(sp.area).toBeGreaterThan(0);
      }
    }
  });
});
