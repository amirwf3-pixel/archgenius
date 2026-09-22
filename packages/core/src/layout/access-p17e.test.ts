import { describe, it, expect } from 'vitest';
import type { Rect } from '../geometry/rect.js';
import { createProject, generate, validateLayout } from '../pipeline.js';
import { buildStressCases } from '../stress/matrix.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';

/**
 * P17-E — EAST/WEST access support (orientation-aware placement only).
 *
 * Depth-dominant sites with accessSide east/west used to fail wholesale (P17-A):
 * the P16-B frame rotates the street to frame-south, and the band model starved
 * in the resulting wide-shallow regime. The fix assembles the public band as one
 * side-by-side row along the street for wide frames — adopted ONLY when it
 * strictly fixes missing program rooms without new minimum deficits or room
 * overlaps (ties keep the standard orientation, so behavior is strictly
 * additive). These tests pin the gained EAST/WEST feasibility, the preserved
 * SOUTH/NORTH behavior, facade correctness, circulation, determinism, honest
 * NC for genuinely impossible geometry, parking, and multi-floor core coherence.
 */

const matrixInput = (id: string) => JSON.parse(JSON.stringify(buildStressCases().find(c => c.id === id)!.input));

const touches = (a: Rect, b: Rect, eps = 0.05): boolean => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (ox >= -eps && Math.abs(oy) <= eps) || (oy >= -eps && Math.abs(ox) <= eps);
};

/** The entrance room must sit ON the building's street-facing line (max | min coordinate over all rooms). */
function entranceOnFacade(bc: any, side: 'east' | 'west'): boolean {
  const fl = bc.floors[0];
  const ent = fl.spaces.find((s: any) => s.type === 'entrance');
  if (!ent) return false;
  const xs = fl.spaces.map((s: any) => [s.rect.x, s.rect.x + s.rect.w]).flat();
  const maxX = Math.max(...xs), minX = Math.min(...xs);
  return side === 'east'
    ? Math.abs(ent.rect.x + ent.rect.w - maxX) < 0.05
    : Math.abs(ent.rect.x - minX) < 0.05;
}

/** Circulation reaches every room: flood-fill from the corridor over rect-touch adjacency (the entry sequence may connect transitively, e.g. entrance→foyer→guest-wc→corridor). */
function circulationReachesRooms(bc: any): boolean {
  const fl = bc.floors[0];
  const rooms = fl.spaces.filter((s: any) => s.rect && s.type !== 'corridor');
  const corr = fl.spaces.filter((s: any) => s.type === 'corridor');
  if (corr.length === 0 || rooms.length === 0) return false;
  const reached = new Set<number>();
  let frontier: number[] = [];
  for (let i = 0; i < rooms.length; i++)
    if (corr.some((c: any) => touches(rooms[i].rect, c.rect, 0.06))) { reached.add(i); frontier.push(i); }
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier)
      for (let j = 0; j < rooms.length; j++) {
        if (reached.has(j)) continue;
        if (touches(rooms[i].rect, rooms[j].rect, 0.06)) { reached.add(j); next.push(j); }
      }
    frontier = next;
  }
  return reached.size === rooms.length;
}

function programComplete(bc: any): boolean {
  const req = (bc as any).programRequirements?.[0]?.byType ?? {};
  const have: Record<string, number> = {};
  for (const s of bc.floors[0].spaces) have[s.type] = (have[s.type] ?? 0) + 1;
  for (const [t, n] of Object.entries(req)) {
    if ((have[t] ?? 0) < (n as number)) return false;
  }
  return true;
}

describe('P17-E — EAST/WEST access gained where geometry permits', () => {
  it('16×22 EAST: feasible, hard-clean, entrance on the east (street) facade, circulation complete', () => {
    const input = matrixInput('R16x22--S1-2bd');
    input.site.accessSide = 'east';
    const res = generate(createProject(input));
    expect(res.infeasible).toBeNull();
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    expect(entranceOnFacade(bc, 'east')).toBe(true);
    expect(programComplete(bc)).toBe(true);
    expect(circulationReachesRooms(bc)).toBe(true);
    // P17-C containment still holds on the compacted envelope
    const fp = bc.floors[0].footprint;
    for (const s of bc.floors[0].spaces) {
      expect(s.rect.x).toBeGreaterThanOrEqual(fp.x - 1e-3);
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(fp.x + fp.w + 1e-3);
      expect(s.rect.y).toBeGreaterThanOrEqual(fp.y - 1e-3);
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(fp.y + fp.h + 1e-3);
    }
  });

  it('16×22 WEST: feasible, hard-clean, entrance on the west (street) facade', () => {
    const input = matrixInput('R16x22--S1-2bd');
    input.site.accessSide = 'west';
    const resW = generate(createProject(input));
    expect(resW.bestCandidate).not.toBeNull();
    const bc = resW.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    expect(entranceOnFacade(bc, 'west')).toBe(true);
    expect(circulationReachesRooms(bc)).toBe(true);
  });

  it('14×26 EAST and WEST: feasible, hard-clean, entrances on the requested facades', () => {
    for (const side of ['east', 'west'] as const) {
      const input = matrixInput('R14x26--S1-2bd');
      input.site.accessSide = side;
      const res = generate(createProject(input));
      expect(res.bestCandidate, `14x26 ${side}`).not.toBeNull();
      const bc = res.bestCandidate!;
      expect(validateLayout(bc).hard).toEqual([]);
      expect(entranceOnFacade(bc, side)).toBe(true);
      expect(circulationReachesRooms(bc)).toBe(true);
    }
  });

  it('wide/depth-balanced EAST case that already worked is unchanged', () => {
    const input = matrixInput('R20x18--S2-3bd');
    input.site.accessSide = 'east';
    const res = generate(createProject(input));
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    expect(entranceOnFacade(bc, 'east')).toBe(true);
  });
});

describe('P17-E — SOUTH/NORTH behavior preserved', () => {
  it('SOUTH stays feasible and the shallow-band row never engages', () => {
    const res = generate(createProject(matrixInput('R16x22--S1-2bd')));
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    // entrance on the SOUTH facade (min-y line of the plan), not on a side street
    const fl = bc.floors[0];
    const ent = fl.spaces.find((s: any) => s.type === 'entrance');
    expect(ent).toBeDefined();
    const minY = Math.min(...fl.spaces.map((s: any) => s.rect.y));
    expect(ent!.rect.y).toBeCloseTo(minY, 3);
    expect(bc.explanations.some(e => e.includes('P17-E'))).toBe(false);
    expect(programComplete(bc)).toBe(true);
    // the audited deep-narrow south case keeps its P17-C compacted envelope
    const dn = generate(createProject(matrixInput('R10x34--S0-1bd-open'))).bestCandidate!;
    expect(validateLayout(dn).hard).toEqual([]);
    expect(dn.floors[0].footprint.h).toBeLessThan(24);
  });

  it('NORTH stays feasible and hard-clean', () => {
    const input = matrixInput('R14x26--S1-2bd');
    input.site.accessSide = 'north';
    const res = generate(createProject(input));
    expect(res.bestCandidate).not.toBeNull();
    expect(validateLayout(res.bestCandidate!).hard).toEqual([]);
  });
});

describe('P17-E — determinism, honest NC, parking, multi-floor coherence', () => {
  it('deterministic repeated generation: identical candidate and byte-identical DXF', () => {
    const input = matrixInput('R14x26--S1-2bd');
    input.site.accessSide = 'east';
    const a = generate(createProject(JSON.parse(JSON.stringify(input)))).bestCandidate!;
    const b = generate(createProject(JSON.parse(JSON.stringify(input)))).bestCandidate!;
    expect(JSON.stringify(a.floors)).toBe(JSON.stringify(b.floors));
    expect(validateDXFStructure(writeDXF(a, 'p17e')).ok).toBe(true);
    expect(writeDXF(a, 'p17e')).toBe(writeDXF(b, 'p17e'));
  });

  it('genuinely impossible EAST geometry stays honest NC with a deterministic reason', () => {
    // 8×10 site → ~4.5 m street-perpendicular depth cannot host public + circulation + private
    const input = matrixInput('R8x10--S0-1bd-open');
    input.site.accessSide = 'east';
    const a = generate(createProject(JSON.parse(JSON.stringify(input))));
    const b = generate(createProject(JSON.parse(JSON.stringify(input))));
    expect(a.bestCandidate).toBeNull();
    expect(a.infeasible).not.toBeNull();
    // honest NC: either the M2 hard gate or the dimension gate — never a silent plan
    expect(['HARD_RULE_VIOLATION', 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION']).toContain(a.infeasible!.code);
    expect(a.infeasible!.explanation).toEqual(b.infeasible!.explanation);
    // 14×26 with the larger S2-3bd program stays honestly infeasible on east
    const input2 = matrixInput('R14x26--S2-3bd');
    input2.site.accessSide = 'east';
    const r2 = generate(createProject(input2));
    expect(r2.bestCandidate).toBeNull();
    expect(['HARD_RULE_VIOLATION', 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION']).toContain(r2.infeasible!.code);
  });

  it('parking + EAST/WEST: requested stalls placed and plan hard-clean', () => {
    for (const side of ['east', 'west'] as const) {
      const input = matrixInput('R20x22--U1-2f4bd');
      const requested = input.building.parkingSpaces ?? 0;
      input.site.accessSide = side;
      const res = generate(createProject(input));
      expect(res.bestCandidate, `20x22 ${side}`).not.toBeNull();
      const bc = res.bestCandidate!;
      expect(validateLayout(bc).hard).toEqual([]);
      expect(bc.floors[0].parkingStalls.length).toBe(requested);
    }
  });

  it('multi-floor EAST with stair-core coherence (M7) and per-floor envelopes (P17-C)', () => {
    const input = matrixInput('R20x22--U1-2f4bd');
    input.site.accessSide = 'east';
    const bc = generate(createProject(input)).bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    expect(bc.floors.length).toBe(2);
    expect(entranceOnFacade(bc, 'east')).toBe(true);
    const [f0, f1] = bc.floors;
    expect(f0.stairs.length).toBeGreaterThan(0);
    expect(f1.stairs.length).toBe(f0.stairs.length);
    for (let i = 0; i < f0.stairs.length; i++) {
      const a = f0.stairs[i].footprint ?? (f0.stairs[i] as any).rect;
      const b = f1.stairs[i].footprint ?? (f1.stairs[i] as any).rect;
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(b.w).toBeCloseTo(a.w, 6);
      expect(b.h).toBeCloseTo(a.h, 6);
    }
    for (const fl of bc.floors) {
      for (const s of fl.spaces) {
        expect(s.rect.x).toBeGreaterThanOrEqual(fl.footprint.x - 1e-3);
        expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(fl.footprint.x + fl.footprint.w + 1e-3);
        expect(s.rect.y).toBeGreaterThanOrEqual(fl.footprint.y - 1e-3);
        expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(fl.footprint.y + fl.footprint.h + 1e-3);
      }
    }
  });
});
