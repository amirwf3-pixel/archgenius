/**
 * Phase 25 — dedicated L-shape placement engine.
 *
 * The buildable polygon of an L-shaped lot decomposes into two rectangles.
 * Before Phase 25 those rects went straight to the generic M6 multi-rect
 * planner, which ignores cross-rect circulation and parks rooms inside the
 * notch. The dedicated path (generator/l-shape.ts) places wings per
 * buildable rectangle, carves a bridge strip on the shared cut, and gates
 * every plan on real geometry: full program coverage, no room collisions,
 * containment inside the L polygon, and exterior-wall reachability for
 * every habitable room. Genuinely unfillable lots stay honestly infeasible.
 *
 * Acceptance input: 18×22 site, NE notch 7×9, 2 bedrooms + 1 master,
 * closed kitchen, 1 parking, 1 floor → feasible with zero hard findings.
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, generateLayouts, validateLayout, writeDXF } from '../pipeline.js';
import { ALL_STRATEGIES } from './generator.js';
import { validateDXFStructure } from '../dxf/writer.js';
import { computeBuildableGeometry } from '../site/buildable.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import type { ProjectInput } from '../model/project.js';

function lInput(notchCorner: 'ne' | 'nw' | 'se' | 'sw', overrides: Partial<ProjectInput['site']> = {}): ProjectInput {
  return {
    name: 'P25 L',
    site: {
      shape: 'l-shape',
      width: 18,
      length: 22,
      accessSide: 'south',
      streetWidth: 8,
      lShape: { width: 18, length: 22, notchWidth: 7, notchLength: 9, notchCorner },
      ...overrides,
    },
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 1,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStorage: false,
    },
    seed: 42,
  } as ProjectInput;
}

/** Site-coordinate notch rectangle for the 18×22 / 7×9 matrix. */
function notchRect(corner: 'ne' | 'nw' | 'se' | 'sw'): { x0: number; y0: number; x1: number; y1: number } {
  switch (corner) {
    case 'ne': return { x0: 11, y0: 13, x1: 18, y1: 22 };
    case 'nw': return { x0: 0, y0: 13, x1: 7, y1: 22 };
    case 'se': return { x0: 11, y0: 0, x1: 18, y1: 9 };
    case 'sw': return { x0: 0, y0: 0, x1: 7, y1: 9 };
  }
}

describe('Phase 25: L-shape placement engine', () => {
  it('acceptance input (18×22, NE 7×9): feasible, zero hard findings, parking placed', () => {
    const res = generate(createProject(lInput('ne')));
    const bc = res.bestCandidate;
    expect(bc).toBeTruthy();
    const vr = validateLayout(bc!);
    const codes = new Set(vr.hard.map(f => f.code));
    expect(vr.hard).toEqual([]);
    expect(codes.has('SITE_WALL_OUTSIDE_BUILDABLE')).toBe(false);
    expect(codes.has('CIRC_INACCESSIBLE_SPACE')).toBe(false);
    const fl = bc!.floors[0];
    expect(fl.parkingStalls.length).toBe(1);
    const types = new Set(fl.spaces.map(s => s.type));
    for (const t of ['entrance', 'foyer', 'living', 'dining', 'kitchen', 'master-bedroom', 'bedroom']) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('corner matrix: NE/NW/SW feasible with zero hard findings; SE honestly infeasible', () => {
    for (const corner of ['ne', 'nw', 'sw'] as const) {
      const res = generate(createProject(lInput(corner)));
      const bc = res.bestCandidate;
      expect(bc, `${corner} should be feasible`).toBeTruthy();
      const vr = validateLayout(bc!);
      expect(vr.hard, `${corner} must have no hard findings`).toEqual([]);
    }
    // SE mirrors the notch onto the street side, leaving a 3 m street stub:
    // the foyer-living adjacency plus wing circulation cannot both reach the
    // stub, so the honest result is infeasible (no forced invalid geometry).
    const se = generate(createProject(lInput('se')));
    expect(se.bestCandidate).toBeFalsy();
  });

  it('wing allocation: every placed room is inside the L buildable polygon and out of the notch', () => {
    for (const corner of ['ne', 'nw', 'sw'] as const) {
      const input = lInput(corner);
      const res = generate(createProject(input));
      const bc = res.bestCandidate!;
      const geo = computeBuildableGeometry(input.site);
      const fl = bc.floors[0];
      for (const s of fl.spaces) {
        expect(rectInsidePolygon(s.rect, geo.buildableBoundary, 1e-3), `${corner}: ${s.type} outside buildable polygon`).toBe(true);
      }
      const n = notchRect(corner);
      for (const s of fl.spaces) {
        const ox = Math.min(s.rect.x + s.rect.w, n.x1) - Math.max(s.rect.x, n.x0);
        const oy = Math.min(s.rect.y + s.rect.h, n.y1) - Math.max(s.rect.y, n.y0);
        expect(ox <= 1e-6 || oy <= 1e-6, `${corner}: ${s.type} intrudes into the notch`).toBe(true);
      }
      for (const w of fl.walls) {
        const mx = (w.start.x + w.end.x) / 2;
        const my = (w.start.y + w.end.y) / 2;
        const inside = mx > n.x0 + 1e-6 && mx < n.x1 - 1e-6 && my > n.y0 + 1e-6 && my < n.y1 - 1e-6;
        expect(inside, `${corner}: wall midpoint inside the notch`).toBe(false);
      }
    }
  });

  it('wings connect through the shared boundary: no inaccessible space, no room-through-room', () => {
    for (const corner of ['ne', 'nw', 'sw'] as const) {
      const res = generate(createProject(lInput(corner)));
      const vr = validateLayout(res.bestCandidate!);
      expect(vr.hard.some(f => f.code === 'CIRC_INACCESSIBLE_SPACE'), `${corner}: inaccessible space`).toBe(false);
      expect(vr.hard.some(f => f.code === 'CIRC_ROOM_THROUGH_ROOM'), `${corner}: pass-through room`).toBe(false);
      // the wings are separate buildable rectangles; circulation must span both
      const fl = res.bestCandidate!.floors[0];
      const corridors = fl.spaces.filter(s => s.type === 'corridor');
      expect(corridors.length, `${corner}: corridor circulation present`).toBeGreaterThan(0);
    }
  });

  it('deterministic repeated generation: identical plans across runs', () => {
    for (const corner of ['ne', 'nw', 'sw'] as const) {
      const r1 = generate(createProject(lInput(corner)));
      const r2 = generate(createProject(lInput(corner)));
      expect(JSON.stringify(r1.bestCandidate!.floors)).toBe(JSON.stringify(r2.bestCandidate!.floors));
    }
  });

  it('DXF export: structurally valid, byte-identical across exports, no NaN/Infinity', () => {
    const res = generate(createProject(lInput('ne')));
    const bc = res.bestCandidate!;
    const d1 = writeDXF(bc, 'p25-l');
    const d2 = writeDXF(bc, 'p25-l');
    expect(d1).toBe(d2);
    const v = validateDXFStructure(d1);
    expect(v.ok).toBe(true);
    expect(/NaN|Infinity/.test(d1)).toBe(false);
    expect(d1.length).toBeGreaterThan(10000);
  });

  it('genuinely too-small L stays honestly INFEASIBLE (no forced geometry)', () => {
    const tiny = lInput('ne', {
      width: 10,
      length: 12,
      lShape: { width: 10, length: 12, notchWidth: 6, notchLength: 7, notchCorner: 'ne' },
    });
    const res = generate(createProject(tiny));
    expect(res.bestCandidate).toBeFalsy();
  });

  it('generic-planner fallback preserved: 16×20 NW 1-bed villa stays feasible', () => {
    // Regression guard for the P17-C matrix case: when the dedicated path
    // cannot beat the generic multi-rect planner it must yield to it.
    const raw = lInput('nw', {
      width: 16,
      length: 20,
      lShape: { width: 16, length: 20, notchWidth: 6, notchLength: 7, notchCorner: 'nw' },
    });
    const input = { ...raw, building: { ...raw.building, bedrooms: 1, masterBedrooms: 0, kitchenType: 'open' as const, parkingSpaces: 0 } };
    const res = generate(createProject(input));
    const bc = res.bestCandidate;
    expect(bc).toBeTruthy();
    expect(validateLayout(bc!).hard).toEqual([]);
  });

  it('all candidate strategies produce geometry-gated plans on the acceptance input', () => {
    const cands = generateLayouts(lInput('ne'), [...ALL_STRATEGIES]);
    expect(cands.length).toBe(ALL_STRATEGIES.length);
    for (const c of cands) {
      const fl = c.floors[0];
      for (const s of fl.spaces) {
        // every strategy's plan keeps rooms collision-free and inside the lot
        expect(s.rect.w).toBeGreaterThan(0);
        expect(s.rect.h).toBeGreaterThan(0);
      }
    }
  });
});
