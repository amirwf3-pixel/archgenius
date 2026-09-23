/**
 * Phase 29-B FIX 2 — L-shape wing-balance selection regression tests.
 *
 * Evidence base (Phase 29 audit): placeSpacesLShape used to return the FIRST
 * gate-passing ladder variant, which could pack almost all rooms into one wing
 * (18×22 NE: a 1.54 m dead residual strip in the street wing, far wing filled)
 * even when a balanced variant passed the same geometry-authoritative gates.
 * The selection now collects every gate-passing plan and ranks by lowest
 * wing-residual imbalance (wingResidualStats), tie-broken by total residual and
 * the existing ladder order; a variant that violates the pipeline's
 * min-dimension contract never displaces a compliant one.
 *
 * Measured on HEAD+P29B (deterministic, seed 42): NE imbalance 10.788 m²
 * (pre-fix ladder-first pick in the improved ladder: 14.03 m²), NW 9.42 m²,
 * SW 15.90 m².
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, validateLayout } from '../pipeline.js';
import { wingResidualStats } from './l-shape.js';
import { computeBuildableGeometry } from '../site/buildable.js';
import type { ProjectInput } from '../model/project.js';

function lInput(corner: 'ne' | 'nw' | 'sw'): ProjectInput {
  return {
    name: 'P25 L',
    site: {
      shape: 'l-shape', width: 18, length: 22, accessSide: 'south', streetWidth: 8,
      lShape: { width: 18, length: 22, notchWidth: 7, notchLength: 9, notchCorner: corner },
    },
    building: {
      type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1,
      kitchenType: 'closed', parkingSpaces: 1, hasStorage: false,
    },
    seed: 42,
  };
}

/** Wing rects sorted street-first (access from the south → lowest y first). */
function wings(corner: 'ne' | 'nw' | 'sw') {
  const geom = computeBuildableGeometry(lInput(corner).site);
  const rects = [...geom.buildableRects].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return { street: rects[0], other: rects[1] };
}

describe('P29-B FIX 2: L-shape wing-residual metric', () => {
  it('computes per-wing residual, imbalance and total from room centroids', () => {
    const street = { x: 0, y: 0, w: 10, h: 10 };  // 100 m², covered 80 → res 20
    const other = { x: 10, y: 0, w: 6, h: 5 };    // 30 m², covered 12 → res 18
    const spaces = [
      { rect: { x: 0, y: 0, w: 8, h: 10 } },      // centroid (4,5) → street
      { rect: { x: 10, y: 0, w: 4, h: 3 } },      // centroid (12,1.5) → other
    ] as any;
    const s = wingResidualStats(spaces, street, other);
    expect(s.resStreet).toBeCloseTo(20, 6);
    expect(s.resOther).toBeCloseTo(18, 6);
    expect(s.imbalance).toBeCloseTo(2, 6);
    expect(s.totalResidual).toBeCloseTo(38, 6);
  });

  it('a room centred outside both wings is not counted', () => {
    const street = { x: 0, y: 0, w: 5, h: 5 };
    const other = { x: 5, y: 0, w: 5, h: 5 };
    const spaces = [{ rect: { x: 100, y: 100, w: 2, h: 2 } }] as any;
    const s = wingResidualStats(spaces, street, other);
    expect(s.resStreet).toBeCloseTo(25, 6);
    expect(s.resOther).toBeCloseTo(25, 6);
    expect(s.imbalance).toBeCloseTo(0, 6);
  });
});

describe('P29-B FIX 2: balanced wing selection on the 18×22 corner matrix', () => {
  // Bounds pin the measured balanced selections (see file header); a regression
  // back to ladder-first picking or to an unbalanced variant exceeds them.
  const BOUNDS = { ne: 11.5, nw: 10.5, sw: 17.0 } as const;

  for (const corner of ['ne', 'nw', 'sw'] as const) {
    it(`${corner}: feasible plan, zero hard findings, wing imbalance within the balanced bound`, () => {
      const input = lInput(corner);
      const res = generate(createProject(input));
      const bc = res.bestCandidate;
      expect(bc, `${corner} should be feasible`).toBeTruthy();
      const vr = validateLayout(bc!);
      expect(vr.hard, `${corner} must have no hard findings`).toEqual([]);
      const { street, other } = wings(corner);
      const stats = wingResidualStats(bc!.floors[0].spaces, street, other);
      expect(
        stats.imbalance,
        `${corner} wing imbalance ${stats.imbalance.toFixed(3)} m² exceeds the balanced bound`,
      ).toBeLessThanOrEqual(BOUNDS[corner]);
    });
  }

  it('ne: balanced selection is deterministic across runs', () => {
    const a = generate(createProject(lInput('ne'))).bestCandidate!;
    const b = generate(createProject(lInput('ne'))).bestCandidate!;
    expect(JSON.stringify(a.floors[0].spaces.map(s => [s.id, s.rect])))
      .toBe(JSON.stringify(b.floors[0].spaces.map(s => [s.id, s.rect])));
  });
});
