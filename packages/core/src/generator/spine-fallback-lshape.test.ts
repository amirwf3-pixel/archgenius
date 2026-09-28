/**
 * Guarded L-shape pass: perpendicular parking retry (only when automatic parking left stalls
 * unplaced) + double-loaded spine fallback in the one usable wing left by the parking band,
 * adopted only through the unchanged adoptSpineVariant guard (fully valid, zero HARD,
 * identical parking geometry, same stair footprint on every floor).
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate } from '../pipeline.js';
import { validateLayout } from '../validation/validator.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import { SPINE_FALLBACK_APPLIED, adoptLShapeParkingRetry } from './generator.js';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';

const TARGET = {
  name: 'L 14x20 SE', deterministic: true, seed: 24680,
  site: {
    shape: 'l-shape', width: 14, length: 20, accessSide: 'south', streetWidth: 10,
    setbacks: { north: 1.5, south: 3, east: 1.5, west: 1.5 },
    jurisdiction: 'Tehran-Municipality-Default', parkingLayout: 'auto',
    lShape: { width: 14, length: 20, notchWidth: 5, notchLength: 7, notchCorner: 'se' },
  },
  building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true },
} as unknown as ProjectInput;
const run = (inp: ProjectInput) => generate(createProject(JSON.parse(JSON.stringify(inp))), { allStrategies: true });
const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard');
const ov = (p: Rect, q: Rect) =>
  Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.02 && Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 0.02;
const contact = (a: Rect, b: Rect) => {
  const e = 1e-6;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (Math.abs(ox) < e && oy > e) return oy;
  if (Math.abs(oy) < e && ox > e) return ox;
  return 0;
};

describe('L-shape 14×20 SE 5×7 — parking retry + double-loaded spine', () => {
  const r = run(TARGET);

  it('VALID with 0 HARD in all four strategies (validator re-run agrees)', () => {
    expect(r.infeasible ?? null).toBeNull();
    expect(r.candidates).toHaveLength(4);
    for (const c of r.candidates) {
      expect(c.valid).toBe(true);
      expect(hard(c)).toEqual([]);
      expect(validateLayout(c).hard).toEqual([]);
      expect(c.explanations.filter(e => e.startsWith(SPINE_FALLBACK_APPLIED) && e.includes('double-loaded'))).toHaveLength(2);
    }
  });

  it('2/2 parking stalls (perpendicular) inside the site, clear of every room', () => {
    for (const c of r.candidates) {
      const f0 = c.floors[0];
      expect(f0.parkingStalls).toHaveLength(2);
      expect(f0.parkingArea?.arrangement).toBe('perpendicular');
      const site = (c as unknown as { siteBoundary: Array<{ x: number; y: number }> }).siteBoundary;
      const cuts = [...f0.parkingStalls.map(s => s.rect), ...(f0.parkingArea?.aisleRect ? [f0.parkingArea.aisleRect] : [])];
      for (const q of cuts) expect(rectInsidePolygon(q, site, 1e-3)).toBe(true);
      for (const f of c.floors) for (const s of f.spaces) for (const q of cuts) expect(ov(s.rect, q)).toBe(false);
    }
  });

  it('no ARCH_PROGRAM_UNPLACED, STAIR_MISSING, CIRC_INACCESSIBLE_SPACE or CIRC_VERTICAL_DISCONNECTED', () => {
    for (const c of r.candidates) {
      for (const code of ['ARCH_PROGRAM_UNPLACED', 'STAIR_MISSING', 'CIRC_INACCESSIBLE_SPACE', 'CIRC_VERTICAL_DISCONNECTED', 'CIRC_ROOM_THROUGH_ROOM']) {
        expect(c.findings.some(f => f.code === code), code).toBe(false);
      }
      const types0 = c.floors[0].spaces.map(s => s.type), types1 = c.floors[1].spaces.map(s => s.type);
      for (const t of ['entrance', 'foyer', 'living', 'dining', 'kitchen', 'guest-wc', 'storage', 'stair-hall', 'corridor']) expect(types0).toContain(t);
      for (const t of ['master-bedroom', 'master-bathroom', 'bathroom', 'stair-hall', 'corridor']) expect(types1).toContain(t);
      expect(types1.filter(t => t === 'bedroom')).toHaveLength(2);
    }
  });

  it('no room overlaps and no geometry outside the buildable L', () => {
    for (const c of r.candidates) {
      const buildable = (c as unknown as { buildableBoundary: Array<{ x: number; y: number }> }).buildableBoundary;
      for (const f of c.floors) {
        for (const s of f.spaces) expect(rectInsidePolygon(s.rect, buildable, 1e-3), `${s.id}`).toBe(true);
        for (let i = 0; i < f.spaces.length; i++) for (let j = i + 1; j < f.spaces.length; j++) {
          expect(ov(f.spaces[i].rect, f.spaces[j].rect), `${f.spaces[i].id} × ${f.spaces[j].id}`).toBe(false);
        }
      }
      for (const code of ['GEO_OVERLAPPING_ROOMS', 'GEO_ROOM_OUTSIDE_FOOTPRINT', 'SITE_ROOM_OUTSIDE_BUILDABLE', 'SITE_WALL_OUTSIDE_BUILDABLE']) {
        expect(c.findings.some(f => f.code === code), code).toBe(false);
      }
    }
  });

  it('identical stair footprint and hall on both floors; every room opens on the corridor or foyer', () => {
    for (const c of r.candidates) {
      expect(c.floors.every(f => f.stairs.length === 1)).toBe(true);
      expect(c.floors[1].stairs[0].footprint).toEqual(c.floors[0].stairs[0].footprint);
      expect(c.floors[1].stairs[0].coreId).toBe(c.floors[0].stairs[0].coreId);
      const halls = c.floors.map(f => f.spaces.find(s => s.type === 'stair-hall')!.rect);
      expect(halls[1]).toEqual(halls[0]);
      for (const f of c.floors) {
        const corr = f.spaces.find(s => s.type === 'corridor')!.rect;
        for (const s of f.spaces) {
          if (s.type === 'corridor' || s.type === 'entrance') continue;
          expect(contact(s.rect, corr), `${s.id} on corridor`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('deterministic: repeated generation is identical', () => {
    const again = run(TARGET);
    expect(again.candidates.map(c => c.metadata.strategy)).toEqual(r.candidates.map(c => c.metadata.strategy));
    again.candidates.forEach((c, i) => expect(JSON.stringify(c.floors)).toBe(JSON.stringify(r.candidates[i].floors)));
  });
});

describe('L-shape pass — guards', () => {
  it('adoptLShapeParkingRetry: only replaces an unplaced-parking base with a retry that places all stalls', () => {
    const mk = (stalls: number, unplaced: boolean) => ({
      findings: unplaced ? [{ code: 'PARKING_PROGRAM_UNPLACED', severity: 'hard', message: '' }] : [],
      floors: [{ parkingStalls: Array.from({ length: stalls }, () => ({})) }],
    }) as unknown as LayoutCandidate;
    const base = mk(0, true);
    const good = mk(2, false);
    expect(adoptLShapeParkingRetry(base, good, 2)).toBe(good);
    expect(adoptLShapeParkingRetry(base, mk(1, false), 2)).toBe(base);
    expect(adoptLShapeParkingRetry(base, mk(0, true), 2)).toBe(base);
    expect(adoptLShapeParkingRetry(mk(2, false), good, 2)).not.toBe(good);
    expect(adoptLShapeParkingRetry(base, good, 0)).toBe(base);
  });

  it('an explicit parallel preference is never overridden', () => {
    const inp = JSON.parse(JSON.stringify(TARGET));
    inp.site.parkingLayout = 'parallel';
    const res = run(inp as ProjectInput);
    const all = [...res.candidates, ...(res.infeasible?.diagnosticCandidates ?? [])];
    for (const c of all) expect(c.floors[0].parkingArea?.arrangement ?? 'parallel').not.toBe('perpendicular');
  });
});
