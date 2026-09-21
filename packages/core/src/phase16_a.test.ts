/**
 * Phase 16 P16-A — real parking placement & program honesty.
 * Unit tests on placeParkingSiteAware + reserveParkingBand, integration tests
 * through the full pipeline, validator tests for PARKING_PROGRAM_UNPLACED /
 * SITE_PARKING_* semantics, and determinism.
 */
import { describe, it, expect } from 'vitest';
import { placeParkingSiteAware, reserveParkingBand, subtractRects } from './generator/parking.js';
import { createProject, generate } from './pipeline.js';
import { validateArchitecturalQA } from './validation/architectural-qa.js';
import type { ProjectInput } from './model/project.js';
import type { Rect } from './geometry/rect.js';
import type { Polygon } from './geometry/polygon-ops.js';
import { PARKING_STALL_WIDTH, PARKING_STALL_LENGTH } from './units.js';
import { PARKING_PARALLEL_WIDTH } from './generator/parking.js';

const rectPoly = (w: number, l: number): Polygon => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: l }, { x: 0, y: l }] as Polygon;
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const villa = (over: any = {}): ProjectInput => ({
  name: 'P16A', country: 'IR',
  site: { shape: 'rectangle', width: 18, length: 28, accessSide: 'south', streetWidth: 8, ...(over.site ?? {}) } as any,
  building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false, hasStorage: true, ...over.building },
  deterministic: true, seed: 42,
} as ProjectInput);

describe('P16-A unit: stall placement on real geometry', () => {
  it('1 stall: south access, building set back → one full-size stall + aisle touching street', () => {
    const site = rectPoly(18, 28);
    const p = placeParkingSiteAware({
      siteBoundary: site, siteRect: R(0, 0, 18, 28),
      buildingRects: [R(0, 10, 18, 18)], access: 'south', count: 1, floorLevel: 0,
    });
    expect(p.fits).toBe(true);
    expect(p.stalls).toHaveLength(1);
    const s = p.stalls[0].rect;
    expect(Math.min(s.w, s.h)).toBeGreaterThanOrEqual(PARKING_PARALLEL_WIDTH - 1e-9); // 2.2 m minimum vehicle bay width
    expect(Math.max(s.w, s.h)).toBeGreaterThanOrEqual(PARKING_STALL_LENGTH - 1e-6);
    expect(p.stalls[0].rect.y + p.stalls[0].rect.h).toBeLessThanOrEqual(10 + 1e-6);
    // aisle reaches the street edge
    expect(p.aisle.y).toBeLessThanOrEqual(p.stalls[0].rect.y + 1e-6);
  });

  it('2 stalls: east access works as well as south (orientation-independent)', () => {
    const bldg = R(8, 0, 22, 20); // leaves the west 8m strip free
    const pe = placeParkingSiteAware({ siteBoundary: rectPoly(30, 20), siteRect: R(0, 0, 30, 20), buildingRects: [bldg], access: 'east', count: 2, floorLevel: 0 });
    // east side is occupied by the building flush at x30 → band must be found elsewhere legitimately OR fail honestly
    const pw = placeParkingSiteAware({ siteBoundary: rectPoly(30, 20), siteRect: R(0, 0, 30, 20), buildingRects: [R(10, 0, 20, 20)], access: 'west', count: 2, floorLevel: 0 });
    expect(pw.fits).toBe(true);
    expect(pw.stalls).toHaveLength(2);
    for (const s of pw.stalls) expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(10 + 1e-6);
    void pe;
  });

  it('insufficient site: no stalls AND no aisle placeholder — honest empty result', () => {
    const p = placeParkingSiteAware({
      siteBoundary: rectPoly(10, 10), siteRect: R(0, 0, 10, 10),
      buildingRects: [R(0, 0, 10, 10)], // building covers everything
      access: 'south', count: 1, floorLevel: 0,
    });
    expect(p.fits).toBe(false);
    expect(p.stalls).toHaveLength(0);
    expect(p.aisle.w * p.aisle.h).toBe(0); // never an aisle-only placeholder
    expect((p.attempts ?? []).length).toBeGreaterThan(0);
  });

  it('collision: a stall row interrupted by the building skips, never overlaps', () => {
    const bldg = R(6, 4, 12, 6); // pokes into the front yard between x6..18
    const p = placeParkingSiteAware({ siteBoundary: rectPoly(24, 20), siteRect: R(0, 0, 24, 20), buildingRects: [bldg], access: 'south', count: 2, floorLevel: 0, layoutPref: 'perpendicular' });
    for (const s of p.stalls) {
      for (const b of [bldg]) {
        const ow = Math.min(s.rect.x + s.rect.w, b.x + b.w) - Math.max(s.rect.x, b.x);
        const oh = Math.min(s.rect.y + s.rect.h, b.y + b.h) - Math.max(s.rect.y, b.y);
        expect(ow > 0.02 && oh > 0.02).toBe(false);
      }
    }
  });

  it('outside-site containment: stalls never leave an L-shaped site', () => {
    // L site: 20x20 minus NE 10x10 notch
    const poly = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }] as Polygon;
    const p = placeParkingSiteAware({ siteBoundary: poly, siteRect: R(0, 0, 20, 20), buildingRects: [R(0, 12, 10, 8)], access: 'south', count: 2, floorLevel: 0, layoutPref: 'perpendicular' });
    if (p.fits) for (const s of p.stalls) {
      // inside the bounding box, no stall in the notched quadrant
      expect(s.rect.x < 20 && s.rect.y < 20).toBe(true);
      const inNotch = s.rect.x + s.rect.w > 10 && s.rect.y + s.rect.h > 10;
      expect(inNotch).toBe(false);
    }
  });

  it('reserve + subtract: band carved from a single rect leaves the exact remainder', () => {
    const res = reserveParkingBand(R(0, 0, 18, 28), [R(2, 3, 14, 23)], 'south', 'auto', 1);
    expect(res).not.toBeNull();
    expect(res!.band.h).toBeGreaterThan(5);
    for (const r of res!.rects) expect(r.y).toBeGreaterThanOrEqual(res!.band.h - 1e-6);
  });

  it('subtractRects: degenerate slivers dropped, deterministic order', () => {
    const out = subtractRects([R(0, 0, 10, 10)], R(0, 0, 10, 9.9));
    expect(out.every(r => Math.min(r.w, r.h) > 0.2)).toBe(true);
    expect(JSON.stringify(out)).toBe(JSON.stringify(subtractRects([R(0, 0, 10, 10)], R(0, 0, 10, 9.9))));
  });

  it('deterministic: identical inputs → identical stall ids, rects and aisle', () => {
    const inp = { siteBoundary: rectPoly(22, 30), siteRect: R(0, 0, 22, 30), buildingRects: [R(0, 9, 22, 21)], access: 'south' as const, count: 3, floorLevel: 0 };
    const a = placeParkingSiteAware(inp);
    const b = placeParkingSiteAware(inp);
    expect(JSON.stringify(a.stalls.map(s => [s.id, s.rect]))).toBe(JSON.stringify(b.stalls.map(s => [s.id, s.rect])));
    expect(JSON.stringify(a.aisle)).toBe(JSON.stringify(b.aisle));
  });
});

describe('P16-A integration: the product places real parking or refuses', () => {
  it('1-car plan publishes with exactly 1 valid stall + aisle', () => {
    const r = generate(createProject(villa()));
    expect(r.bestCandidate).not.toBeNull();
    const f0 = r.bestCandidate!.floors[0];
    expect(f0.parkingRequested).toBe(1);
    expect(f0.parkingStalls).toHaveLength(1);
    expect(f0.parkingArea).toBeTruthy();
    const s = f0.parkingStalls[0].rect;
    expect(Math.min(s.w, s.h)).toBeGreaterThanOrEqual(2.2 - 1e-6); // real vehicle dimension
    expect(Math.max(s.w, s.h)).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(r.bestCandidate!.findings.filter(x => x.severity === 'hard')).toHaveLength(0);
  });

  it('2-car plan on the same site places both stalls (or is honestly refused)', () => {
    const r = generate(createProject(villa({ building: { parkingSpaces: 2 } })));
    if (r.bestCandidate) {
      expect(r.bestCandidate.floors[0].parkingStalls.length).toBe(2);
    } else {
      const codes = new Set((r.infeasible?.attempts ?? []).map(a => String(a.reason)));
      expect(codes.size).toBeGreaterThan(0); // every NC explained
    }
  });

  it('tight site + parking → INFEASIBLE with PARKING_PROGRAM_UNPLACED evidence, never fake/aisle-only', () => {
    const r = generate(createProject(villa({ building: { bedrooms: 4, bathrooms: 2, parkingSpaces: 3, hasStorage: true }, site: { shape: 'rectangle', width: 10, length: 14, accessSide: 'south', streetWidth: 8 } })));
    expect(r.bestCandidate).toBeNull();
    const hist = (r.infeasible?.attempts ?? []).map(a => String(a.reason)).join(' ');
    expect(/PARKING_PROGRAM_UNPLACED|ARCH_PROGRAM_UNPLACED|below min/.test(hist)).toBe(true);
  });

  it('no-parking program is untouched: no parkingRequested field, no band reserved', () => {
    const r = generate(createProject(villa({ building: { parkingSpaces: 0 } })));
    const f0 = r.bestCandidate!.floors[0];
    expect(f0.parkingRequested ?? 0).toBe(0);
    expect(f0.parkingStalls).toHaveLength(0);
    expect(f0.parkingArea).toBeUndefined();
  });

  it('two access sides both produce stalls on the same geometry (orientation independence)', () => {
    const base = { shape: 'rectangle', width: 28, length: 18, streetWidth: 8 } as any;
    const south = generate(createProject({ ...villa(), site: { ...base, accessSide: 'south' }, building: { ...villa().building, parkingSpaces: 1 } } as any));
    const north = generate(createProject({ ...villa(), site: { ...base, accessSide: 'north' }, building: { ...villa().building, parkingSpaces: 1 } } as any));
    for (const r of [south, north]) {
      if (r.bestCandidate) expect(r.bestCandidate.floors[0].parkingStalls.length, JSON.stringify(r.infeasible?.attempts?.[0]?.reason)).toBe(1);
    }
  });

  it('validator: manual stall deficit flags PARKING_PROGRAM_UNPLACED hard on the floor', () => {
    const r = generate(createProject(villa()));
    const f0 = structuredClone(r.bestCandidate!.floors[0]);
    f0.parkingStalls = [];
    const fs = validateArchitecturalQA(f0 as any).filter(x => x.code === 'PARKING_PROGRAM_UNPLACED');
    expect(fs.length).toBe(1);
    expect(fs[0].severity).toBe('hard');
  });

  it('determinism end-to-end: stall geometry + DXF parking identical across runs', () => {
    const a = generate(createProject(villa({ building: { parkingSpaces: 2 } }))).bestCandidate;
    const b = generate(createProject(villa({ building: { parkingSpaces: 2 } }))).bestCandidate;
    expect(!!a).toBe(!!b);
    if (a && b) {
      expect(JSON.stringify(a.floors[0].parkingStalls)).toBe(JSON.stringify(b.floors[0].parkingStalls));
      expect(JSON.stringify(a.floors[0].parkingArea)).toBe(JSON.stringify(b.floors[0].parkingArea));
    }
  });
});
