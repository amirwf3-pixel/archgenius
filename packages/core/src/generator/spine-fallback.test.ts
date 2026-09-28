/**
 * Guarded single-loaded spine fallback: when no normal candidate is valid although the
 * requested parking WAS placed, the reserved slice is rebuilt with a full-length corridor
 * along the access facade and one band of rooms along the rear facade — a real stair core
 * on every floor, every room with its own corridor door — and adopted only when the full
 * validator reports zero HARD findings with the parking geometry unchanged.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate } from '../pipeline.js';
import { SPINE_FALLBACK_APPLIED, PARKING_CUTOUT_APPLIED, sliceFrame } from './generator.js';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Space } from '../model/space.js';

const BUILDING = { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', hasStair: true, hasElevator: false, hasStorage: true };
const lot = (w: number, l: number, access: string, setbacks: Record<string, number>, parkingSpaces: number, seed: number): ProjectInput => ({
  name: `${w}x${l}`, deterministic: true, seed,
  site: { shape: 'rectangle', width: w, length: l, accessSide: access, streetWidth: 8, setbacks, jurisdiction: 'Tehran-Municipality-Default', parkingLayout: 'auto' },
  building: { ...BUILDING, parkingSpaces },
} as unknown as ProjectInput);
const run = (inp: ProjectInput) => generate(createProject(JSON.parse(JSON.stringify(inp))), { allStrategies: true });
const usesSpine = (c: LayoutCandidate) => c.explanations.some(e => e.startsWith(SPINE_FALLBACK_APPLIED));
const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');
const contact = (a: Space, b: Space) => {
  const A = a.rect, B = b.rect, e = 1e-6;
  const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
  const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
  if (Math.abs(ox) < e && oy > e) return oy;
  if (Math.abs(oy) < e && ox > e) return ox;
  return 0;
};

const TARGET = lot(12.4, 18.6, 'east', { north: 1.5, south: 1.5, east: 3, west: 1.5 }, 2, 98765);
const CASES: Array<[string, ProjectInput]> = [
  ['12.4×18.6 east (product case)', TARGET],
  ['13.1×19.3 east, asymmetric setbacks', lot(13.1, 19.3, 'east', { north: 1.8, south: 1.4, east: 3.2, west: 1.2 }, 2, 4242)],
  ['12.6×19.8 west, asymmetric setbacks', lot(12.6, 19.8, 'west', { north: 1.3, south: 1.7, east: 1.4, west: 3.1 }, 2, 31337)],
  ['12.4×18.6 east, 1 parking', lot(12.4, 18.6, 'east', { north: 1.5, south: 1.5, east: 3, west: 1.5 }, 1, 98765)],
];

describe.each(CASES)('single-loaded spine fallback — %s', (_n, inp) => {
  const r = run(inp);
  const requested = (inp.building as { parkingSpaces: number }).parkingSpaces;

  it('VALID with 0 HARD in all four strategies, via the spine fallback (never the parking cutout)', () => {
    expect(r.infeasible ?? null).toBeNull();
    expect(r.candidates).toHaveLength(4);
    for (const c of r.candidates) {
      expect(c.valid).toBe(true);
      expect(hard(c)).toEqual([]);
      expect(usesSpine(c)).toBe(true);
      expect(c.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED))).toBe(false);
    }
  });

  it('kitchen placed; no ARCH_PROGRAM_UNPLACED, STAIR_MISSING or PARKING_PROGRAM_UNPLACED', () => {
    for (const c of r.candidates) {
      expect(c.floors[0].spaces.some(s => s.type === 'kitchen')).toBe(true);
      for (const code of ['ARCH_PROGRAM_UNPLACED', 'STAIR_MISSING', 'PARKING_PROGRAM_UNPLACED']) expect(c.findings.some(f => f.code === code)).toBe(false);
      for (const req of c.programRequirements ?? []) {
        const got: Record<string, number> = {};
        for (const sp of c.floors[req.level].spaces) got[sp.type] = (got[sp.type] ?? 0) + 1;
        for (const [t, n] of Object.entries(req.byType)) expect(got[t] ?? 0, `floor ${req.level} ${t}`).toBeGreaterThanOrEqual(n as number);
      }
    }
  });

  it('parking stays placed (all requested stalls) and never overlaps the building', () => {
    for (const c of r.candidates) {
      const f0 = c.floors[0];
      expect(f0.parkingStalls).toHaveLength(requested);
      const cuts = [...f0.parkingStalls.map(s => s.rect), ...(f0.parkingArea?.aisleRect ? [f0.parkingArea.aisleRect] : [])];
      for (const f of c.floors) for (const s of f.spaces) for (const q of cuts) {
        const ox = Math.min(s.rect.x + s.rect.w, q.x + q.w) - Math.max(s.rect.x, q.x), oy = Math.min(s.rect.y + s.rect.h, q.y + q.h) - Math.max(s.rect.y, q.y);
        expect(ox > 0.02 && oy > 0.02).toBe(false);
      }
    }
  });

  it('stair core connected on both floors: same stair footprint and hall, each hall on its corridor', () => {
    for (const c of r.candidates) {
      expect(c.floors.every(f => f.stairs.length === 1)).toBe(true);
      expect(c.floors[1].stairs[0].footprint).toEqual(c.floors[0].stairs[0].footprint);
      expect(c.floors[1].stairs[0].coreId).toBe(c.floors[0].stairs[0].coreId);
      const halls = c.floors.map(f => f.spaces.find(s => s.type === 'stair-hall')!);
      expect(halls[1].rect).toEqual(halls[0].rect);
      for (const f of c.floors) {
        const hall = f.spaces.find(s => s.type === 'stair-hall')!, corr = f.spaces.find(s => s.type === 'corridor')!;
        expect(contact(hall, corr)).toBeGreaterThan(0.9);
      }
      expect(c.findings.some(f => ['CIRC_VERTICAL_DISCONNECTED', 'CIRC_INACCESSIBLE_SPACE'].includes(f.code))).toBe(false);
    }
  });

  it('no through-bedroom access: every upper bedroom / bathroom opens straight onto the corridor', () => {
    for (const c of r.candidates) {
      expect(c.findings.some(f => f.code === 'CIRC_ROOM_THROUGH_ROOM')).toBe(false);
      const up = c.floors[1];
      const corr = up.spaces.find(s => s.type === 'corridor')!;
      for (const s of up.spaces.filter(sp => ['bedroom', 'master-bedroom', 'bathroom', 'master-bathroom'].includes(sp.type))) {
        expect(contact(s, corr), s.id).toBeGreaterThan(0.9);
      }
    }
  });

  it('deterministic: repeated generation is identical', () => {
    const again = run(inp);
    expect(again.candidates.map(c => c.metadata.strategy)).toEqual(r.candidates.map(c => c.metadata.strategy));
    again.candidates.forEach((c, i) => expect(JSON.stringify(c.floors)).toBe(JSON.stringify(r.candidates[i].floors)));
  });
});

describe('single-loaded spine fallback — guard', () => {
  it('sliceFrame maps the access facade to v = 0 for every access side', () => {
    const slice = { x: 1, y: 2, w: 5, h: 15 };
    expect(sliceFrame(slice, 'east').toWorld(0, 1, 0, 1)).toEqual({ x: 5, y: 2, w: 1, h: 1 });
    expect(sliceFrame(slice, 'west').toWorld(0, 1, 0, 1)).toEqual({ x: 1, y: 2, w: 1, h: 1 });
    expect(sliceFrame(slice, 'south').toWorld(0, 1, 0, 1)).toEqual({ x: 1, y: 2, w: 1, h: 1 });
    expect(sliceFrame(slice, 'north').toWorld(0, 1, 0, 1)).toEqual({ x: 1, y: 16, w: 1, h: 1 });
  });

  it('existing results are untouched: 12×18 south keeps the parking cutout, 15×22 keeps its normal plan', () => {
    const a = run(lot(12, 18, 'south', { north: 1.5, south: 3, east: 1.5, west: 1.5 }, 2, 424242));
    expect(a.candidates.every(c => c.valid && !usesSpine(c) && c.explanations.some(e => e.startsWith(PARKING_CUTOUT_APPLIED)))).toBe(true);
    const b = run(lot(15, 22, 'south', { north: 1.5, south: 3, east: 1.5, west: 1.5 }, 2, 12345));
    expect(b.bestCandidate).not.toBeNull();
    expect(b.candidates.some(usesSpine)).toBe(false);
  });

  it('parking failures never use the spine fallback (8×25 with 1 parking stays as before)', () => {
    const r = run(lot(8, 25, 'south', { north: 1.5, south: 3, east: 1.5, west: 1.5 }, 1, 777));
    expect(r.bestCandidate).toBeNull();
    const diag = r.infeasible?.diagnosticCandidates ?? [];
    expect(diag.some(usesSpine)).toBe(false);
  });
});
