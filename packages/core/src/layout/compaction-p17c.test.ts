import { describe, it, expect } from 'vitest';
import { applyFloorCompaction } from './compaction.js';
import type { Floor } from '../model/floor.js';
import type { Rect } from '../geometry/rect.js';
import { createProject, generate, validateLayout } from '../pipeline.js';
import { buildStressCases } from '../stress/matrix.js';
import { writeDXF, validateDXFStructure } from '../dxf/writer.js';

/**
 * P17-C — per-floor envelope compaction (post-placement, geometry declaration).
 *
 * Covers the mandated scenarios: deep/narrow residual depth, multi-floor unequal
 * demand, normal (no unnecessary shrink), parking + compaction, stair/core +
 * compaction, L-shape irregular site, deterministic regeneration, and the
 * unsafe-compaction fallback.
 */

const space = (id: string, type: string, rect: Rect): any => ({
  id, type, label: type, privacy: 'public', zone: 'public',
  rect, polygon: [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
  ],
  area: rect.w * rect.h, targetArea: rect.w * rect.h, minArea: 1,
  wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
});

function floor(level: number, footprint: Rect, spaces: any[], extra: Partial<Floor> = {}): Floor {
  return {
    level, floorHeight: 3, elevation: level * 3,
    footprint, spaces,
    walls: [], openings: [], stairs: [], elevators: [], furniture: [], parkingStalls: [],
    ...extra,
  } as Floor;
}

const matrixInput = (id: string) => JSON.parse(JSON.stringify(buildStressCases().find(c => c.id === id)!.input));

describe('P17-C compaction unit behavior', () => {
  it('deep/narrow floor: large residual depth is compacted away', () => {
    // 6x29.5 envelope, program only reaches y=22.5 — the audited deep-narrow shape.
    const fl = floor(0, { x: 2, y: 1.5, w: 6, h: 29.5 }, [
      space('a', 'living', { x: 2, y: 1.5, w: 6, h: 12 }),
      space('b', 'bedroom', { x: 2, y: 13.5, w: 6, h: 9 }),
    ]);
    expect(applyFloorCompaction(fl)).toBe(true);
    expect(fl.footprint.h).toBeCloseTo(21, 6);
    expect(fl.footprint.w).toBeCloseTo(6, 6);
    expect(fl.footprint.y).toBeCloseTo(1.5, 6);
  });

  it('normal rectangular case with a full envelope is NOT shrunk', () => {
    const fl = floor(0, { x: 0, y: 0, w: 12, h: 17.5 }, [
      space('a', 'living', { x: 0, y: 0, w: 12, h: 9 }),
      space('b', 'bedroom', { x: 0, y: 9, w: 12, h: 8.5 }),
    ]);
    expect(applyFloorCompaction(fl)).toBe(false);
    expect(fl.footprint).toEqual({ x: 0, y: 0, w: 12, h: 17.5 });
  });

  it('small intentional voids inside the occupied bbox do not block compaction', () => {
    // two room clusters with a 1x1 gap between them — bbox spans the gap (it is
    // smaller than the old envelope, so the envelope shrinks to the bbox).
    const fl = floor(0, { x: 0, y: 0, w: 20, h: 10 }, [
      space('a', 'living', { x: 0, y: 0, w: 8, h: 10 }),
      space('b', 'bedroom', { x: 10, y: 0, w: 8, h: 10 }),
    ]);
    expect(applyFloorCompaction(fl)).toBe(true);
    expect(fl.footprint.w).toBeCloseTo(18, 6);
  });

  it('unsafe compaction falls back without corrupting geometry', () => {
    const fl = floor(0, { x: 0, y: 0, w: 20, h: 10 }, [
      space('a', 'living', { x: 0, y: 0, w: 8, h: 10 }),
    ]);
    // corrupt the invariant: a space outside the current footprint on purpose
    // (cannot come from the generator — exactly the situation the fallback
    // exists for). Compaction must keep the original envelope untouched rather
    // than declare a box that excludes placed geometry.
    (fl.spaces[0].rect as Rect).x = -5;
    const before = { ...fl.footprint };
    expect(applyFloorCompaction(fl)).toBe(false);
    expect(fl.footprint).toEqual(before);
    // the placed space itself is never modified by the fallback
    expect(fl.spaces[0].rect.x).toBe(-5);
  });

  it('empty floors keep their declared envelope', () => {
    const fl = floor(0, { x: 0, y: 0, w: 10, h: 10 }, []);
    expect(applyFloorCompaction(fl)).toBe(false);
    expect(fl.footprint).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});

describe('P17-C pipeline integration', () => {
  it('deep/narrow site: no more huge northern residual, plan stays hard-clean', () => {
    const res = generate(createProject(matrixInput('R10x34--S0-1bd-open')));
    const bc = res.bestCandidate!;
    expect(res.infeasible).toBeNull();
    expect(validateLayout(bc).hard).toEqual([]);
    const fp = bc.floors[0].footprint;
    // The old envelope was the full buildable rect (6 x ~29.5); the compacted
    // envelope must be materially shorter than the buildable depth.
    expect(fp.h).toBeLessThan(24);
    // every room still inside the (compacted) footprint
    for (const s of bc.floors[0].spaces) {
      expect(s.rect.x).toBeGreaterThanOrEqual(fp.x - 1e-3);
      expect(s.rect.y).toBeGreaterThanOrEqual(fp.y - 1e-3);
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(fp.x + fp.w + 1e-3);
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(fp.y + fp.h + 1e-3);
    }
    // program completeness unchanged (programRequirements survive)
    const req = (bc as any).programRequirements[0].byType;
    const have: Record<string, number> = {};
    for (const s of bc.floors[0].spaces) have[s.type] = (have[s.type] ?? 0) + 1;
    for (const [t, n] of Object.entries(req)) expect(have[t] ?? 0).toBeGreaterThanOrEqual(n as number);
  });

  it('multi-floor unequal demand: per-floor envelopes, cores still aligned', () => {
    const res = generate(createProject(matrixInput('R14x26--U0-2f3bd')));
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    const [f0, f1] = bc.floors;
    // F1 (bedrooms strip) compacts to a materially smaller envelope than the
    // full buildable rect — per-floor envelopes, no blind inheritance.
    expect(f1.footprint.w * f1.footprint.h).toBeLessThan(f0.footprint.w * f0.footprint.h);
    // stair core rects are identical across floors (placement untouched)
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
    // upper-floor stair well inside its own (compacted) envelope
    for (const st of f1.stairs) {
      const r = (st as any).footprint ?? (st as any).rect;
      expect(r.x).toBeGreaterThanOrEqual(f1.footprint.x - 1e-3);
      expect(r.x + r.w).toBeLessThanOrEqual(f1.footprint.x + f1.footprint.w + 1e-3);
      expect(r.y).toBeGreaterThanOrEqual(f1.footprint.y - 1e-3);
      expect(r.y + r.h).toBeLessThanOrEqual(f1.footprint.y + f1.footprint.h + 1e-3);
    }
  });

  it('parking + compaction: stalls and aisle stay inside the declared envelope', () => {
    const res = generate(createProject(matrixInput('R25x22--S3-4bd')));
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    const fl = bc.floors[0];
    expect(fl.parkingStalls.length).toBeGreaterThan(0);
    const fp = fl.footprint;
    for (const p of fl.parkingStalls) {
      expect(p.rect.x).toBeGreaterThanOrEqual(fp.x - 1e-3);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(fp.x + fp.w + 1e-3);
      expect(p.rect.y).toBeGreaterThanOrEqual(fp.y - 1e-3);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(fp.y + fp.h + 1e-3);
    }
    // P16-A intact: the requested stall count is exactly placed
    expect(fl.parkingStalls.length).toBe(fl.parkingRequested ?? fl.parkingStalls.length);
  });

  it('L-shape irregular site: compaction only shrinks the bbox and keeps M6 data', () => {
    const res = generate(createProject(matrixInput('L1--S0-1bd-open')));
    const bc = res.bestCandidate!;
    expect(validateLayout(bc).hard).toEqual([]);
    const fl = bc.floors[0];
    const rects = (fl as any).buildableRects as Rect[];
    expect(rects.length).toBeGreaterThan(0);
    // old declared envelope = buildable bbox (L-bbox); compacted must be a
    // strict subset in area, still contain every placed room, and the M6
    // decomposition data must be untouched (polygon-aware placement intact).
    const bxs = (fl as any).buildableBoundary.map((p: { x: number; y: number }) => p.x);
    const bys = (fl as any).buildableBoundary.map((p: { x: number; y: number }) => p.y);
    const bx0 = Math.min(...bxs), by0 = Math.min(...bys);
    const bw = Math.max(...bxs) - bx0, bh = Math.max(...bys) - by0;
    expect(fl.footprint.w * fl.footprint.h).toBeLessThan(bw * bh);
    expect(fl.footprint.x).toBeGreaterThanOrEqual(bx0 - 1e-6);
    expect(fl.footprint.y).toBeGreaterThanOrEqual(by0 - 1e-6);
    for (const s of fl.spaces) {
      expect(s.rect.x).toBeGreaterThanOrEqual(fl.footprint.x - 1e-3);
      expect(s.rect.y).toBeGreaterThanOrEqual(fl.footprint.y - 1e-3);
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(fl.footprint.x + fl.footprint.w + 1e-3);
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(fl.footprint.y + fl.footprint.h + 1e-3);
    }
    expect(rects).toEqual([{ x: 8, y: 1.5, w: 6, h: 15.5 }, { x: 2, y: 1.5, w: 6, h: 8.5 }]);
  });

  it('deterministic repeated generation: identical footprints and DXF', () => {
    const input = matrixInput('R10x34--S0-1bd-open');
    const a = generate(createProject(JSON.parse(JSON.stringify(input))));
    const b = generate(createProject(JSON.parse(JSON.stringify(input))));
    for (let i = 0; i < a.bestCandidate!.floors.length; i++) {
      expect(a.bestCandidate!.floors[i].footprint).toEqual(b.bestCandidate!.floors[i].footprint);
    }
    expect(writeDXF(a.bestCandidate!, 'p17c')).toBe(writeDXF(b.bestCandidate!, 'p17c'));
    expect(validateDXFStructure(writeDXF(a.bestCandidate!, 'p17c')).ok).toBe(true);
  });

  it('compacted envelopes carry an honest explanation entry', () => {
    const res = generate(createProject(matrixInput('R10x34--S0-1bd-open')));
    expect(res.bestCandidate!.explanations.some(e => e.includes('Envelope compacted to placed geometry'))).toBe(true);
  });
});
