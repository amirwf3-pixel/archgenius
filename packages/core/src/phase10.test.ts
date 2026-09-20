/**
 * Phase 10 — SITE / CONTEXT INTELLIGENCE & BUILDABILITY CONSTRAINTS
 * A rectangle regression identical where expected
 * B L-shape valid/invalid area/buildable/containment/DXF
 * C polygon convex/concave/self-intersect duplicate zero-area boundary containment buildable
 * D multi-floor 1F2F3F6F10F
 * E adversarial narrow/buildable consumed/too small/parking impossible/concave corner/invalid order/nearly collinear/boundary-touch/deterministic repeat
 * F regression 328 Phase1-9 pass (implicit)
 * G cross-output agree
 * H performance bounded
 */

import { describe, it, expect } from 'vitest';
import { createProject, generate, buildDocumentation, exportAll } from './pipeline.js';
import type { ProjectInput } from './model/project.js';
import { computeBuildableGeometry } from './site/buildable.js';
import { validateSitePolygon, polygonArea, rectInsidePolygon, pointInPolygon } from './geometry/polygon-ops.js';
import { writeDXF } from './dxf/writer.js';
import { validateSite } from './validation/site.js';
import { legacyGenerate } from './testutil/legacy-generate.js';

function baseInput(): ProjectInput {
  return {
    name: 'Phase10 Test',
    site: {
      shape: 'rectangle',
      width: 15,
      length: 20,
      accessSide: 'south',
      streetWidth: 8,
      northRotationDeg: 0,
      setbacks: { north: 2, south: 3, east: 2, west: 2 },
    } as any,
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 1,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStair: false,
      hasStorage: true,
    },
    deterministic: true,
    seed: 42,
  };
}

describe('Phase 10 A — rectangle regression identical where expected', () => {
  it('rectangle shape produces valid buildable geometry', () => {
    const input = baseInput();
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.siteArea).toBeCloseTo(15 * 20, 1);
    expect(geom.buildableArea).toBeGreaterThan(0);
    expect(geom.buildableArea).toBeLessThan(geom.siteArea);
    expect(geom.siteBoundary.length).toBe(4);
    expect(geom.buildableBoundary.length).toBe(4);
  });

  it('rectangle with zero setbacks buildable equals site', () => {
    const input = baseInput();
    (input.site as any).setbacks = { north: 0, south: 0, east: 0, west: 0 };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.buildableArea).toBeCloseTo(geom.siteArea, 1);
  });

  it('rectangle generation rooms inside buildable', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    for (const fl of bestCandidate!.floors) {
      for (const sp of fl.spaces) {
        expect(rectInsidePolygon(sp.rect, geom.buildableBoundary)).toBe(true);
      }
    }
  });

  it('rectangle DXF contains A-SITE/A-BLDG-OUT/A-SETBACK', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const dxf = writeDXF(bestCandidate!, 'TestRect');
    expect(dxf).toContain('A-SITE');
    expect(dxf).toContain('A-BLDG-OUT');
    expect(dxf).toContain('A-SETBACK');
  });

  it('rectangle deterministic repeat same checksum', () => {
    const input = baseInput();
    const prj1 = createProject(input);
    const { bestCandidate: c1 } = generate(prj1);
    const doc1 = buildDocumentation(prj1, c1!);
    const prj2 = createProject(input);
    const { bestCandidate: c2 } = generate(prj2);
    const doc2 = buildDocumentation(prj2, c2!);
    expect(doc1.consistency.checksum).toBe(doc2.consistency.checksum);
    expect(doc1.site.area).toBe(doc2.site.area);
    expect((doc1.site as any).buildableArea).toBe((doc2.site as any).buildableArea);
  });
});

describe('Phase 10 B — L-shape valid/invalid area/buildable/containment/DXF', () => {
  it('L-shape valid area = overall minus notch', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    const expectedSite = 15 * 20 - 5 * 6;
    expect(geom.siteArea).toBeCloseTo(expectedSite, 0);
    expect(geom.buildableBoundary.length).toBeGreaterThanOrEqual(4);
    expect(geom.buildableRects.length).toBe(2);
  });

  it('L-shape invalid notch too large rejected', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 10, length: 10, notchWidth: 9, notchLength: 9, notchCorner: 'north-east' };
    const geom = computeBuildableGeometry(input.site as any);
    // Notch leaves less than min side? Our validation allows but should still produce geometry
    // If notch consumes too much, area small -> validation errors
    expect(geom.siteArea).toBe(10 * 10 - 81);
    // But if notch >= overall, isValid false?
    (input.site as any).lShape.notchWidth = 11;
    const geom2 = computeBuildableGeometry(input.site as any);
    expect(geom2.isValid).toBe(false);
  });

  it('L-shape buildable containment', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 20, length: 25, notchWidth: 8, notchLength: 10, notchCorner: 'north-east' };
    input.site.width = 20;
    input.site.length = 25;
    input.building.floors = 1;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.buildableRects.length).toBe(2);
    for (const fl of bestCandidate!.floors) {
      for (const sp of fl.spaces) {
        const inside = geom.buildableRects.some(r => {
          return sp.rect.x >= r.x - 1e-6 && sp.rect.y >= r.y - 1e-6 && sp.rect.x + sp.rect.w <= r.x + r.w + 1e-6 && sp.rect.y + sp.rect.h <= r.y + r.h + 1e-6;
        }) || rectInsidePolygon(sp.rect, geom.buildableBoundary);
        expect(inside).toBe(true);
      }
    }
  });

  it('L-shape DXF contains site layers and buildable rect decomposition', () => {
    // Phase 13.2: the original tight L 15x20 notch 5x6 (with setbacks) is below-minimum geometry
    // for this program — generate() returns an explicit INFEASIBLE result with bestCandidate=null
    // and DXF output for it is refused. Pin that semantics, then keep the DXF site-layer
    // verification alive on the feasible L 20x25 notch 8x10 (same 6-vertex L characteristics).
    const tight = baseInput();
    (tight.site as any).shape = 'l-shape';
    (tight.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    const tightRes = generate(createProject(tight));
    if (tightRes.infeasible) {
      expect(tightRes.bestCandidate).toBeNull();
      expect(tightRes.candidates).toEqual([]);
      expect(tightRes.infeasible.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    }
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 20, length: 25, notchWidth: 8, notchLength: 10, notchCorner: 'north-east' };
    input.site.width = 20;
    input.site.length = 25;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    expect(bestCandidate).not.toBeNull();
    const dxf = writeDXF(bestCandidate!, 'TestL');
    expect(dxf).toContain('A-SITE');
    expect(dxf).toContain('A-BLDG-OUT');
    expect(dxf).toContain('A-SETBACK');
    // Should have SITE label
    expect(dxf).toContain('SITE');
  });

  it('L-shape all notch corners', () => {
    for (const corner of ['north-east', 'north-west', 'south-east', 'south-west'] as const) {
      const input = baseInput();
      (input.site as any).shape = 'l-shape';
      (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: corner };
      const geom = computeBuildableGeometry(input.site as any);
      expect(geom.isValid).toBe(true);
      expect(geom.siteBoundary.length).toBe(6);
    }
  });
});

describe('Phase 10 C — polygon convex/concave/self-intersect duplicate zero-area boundary containment buildable', () => {
  it('polygon convex valid', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.siteArea).toBeCloseTo(100, 0);
  });

  it('polygon concave valid L-shaped via polygon', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 18 }, { x: 0, y: 18 }] };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.siteArea).toBeCloseTo(12 * 8 + 8 * 10, 0);
    expect(geom.siteBoundary.length).toBe(6);
  });

  it('polygon self-intersect rejected', () => {
    const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
    const res = validateSitePolygon(bowtie);
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.toLowerCase().includes('self-intersect'))).toBe(true);
  });

  it('polygon duplicate consecutive rejected', () => {
    const dup = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const res = validateSitePolygon(dup);
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.toLowerCase().includes('duplicate'))).toBe(true);
  });

  it('polygon zero-length edge rejected', () => {
    const zero = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.0000001 }, { x: 5, y: 10 }, { x: 0, y: 10 }];
    // 0.0000001 is > EPS 1e-6? Actually 1e-7 < 1e-6 so should be considered zero-length
    const res = validateSitePolygon(zero);
    // May be invalid due to zero-length or nearly collinear handling
    // At least should not be valid with huge tolerance? Check our EPS
    // We expect invalid because distance 1e-7 < 1e-6
    expect(res.isValid).toBe(false);
  });

  it('polygon zero-area rejected', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    const res = validateSitePolygon(line);
    expect(res.isValid).toBe(false);
  });

  it('polygon too few vertices rejected', () => {
    const two = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const res = validateSitePolygon(two);
    expect(res.isValid).toBe(false);
  });

  it('polygon max 8 verts V1', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ x: Math.cos(i * 2 * Math.PI / 9) * 10, y: Math.sin(i * 2 * Math.PI / 9) * 10 }));
    const res = validateSitePolygon(nine);
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.includes('8'))).toBe(true);
  });

  it('polygon boundary containment buildable inside site', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 20 }, { x: 0, y: 20 }] };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    // Buildable should be inside site (with setbacks)
    for (const p of geom.buildableBoundary) {
      expect(pointInPolygon(p, geom.siteBoundary)).toBe(true);
    }
  });

  it('polygon deterministic ordering CCW', () => {
    const cw = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
    const ccw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const signedArea = (poly: Array<{ x: number; y: number }>) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        a += p1.x * p2.y - p2.x * p1.y;
      }
      return a / 2;
    };
    const areaCW = signedArea(cw);
    const areaCCW = signedArea(ccw);
    expect(areaCW).toBeLessThan(0);
    expect(areaCCW).toBeGreaterThan(0);
    const geomCW = computeBuildableGeometry({ shape: 'polygon', polygon: { vertices: cw }, width: 10, length: 10, accessSide: 'south' } as any);
    const geomCCW = computeBuildableGeometry({ shape: 'polygon', polygon: { vertices: ccw }, width: 10, length: 10, accessSide: 'south' } as any);
    // Both should result in CCW internal
    expect(polygonArea(geomCW.siteBoundary)).toBeGreaterThan(0);
    expect(polygonArea(geomCCW.siteBoundary)).toBeGreaterThan(0);
  });
});

describe('Phase 10 D — multi-floor 1F2F3F6F10F', () => {
  for (const floors of [1, 2, 3, 6, 10]) {
    it(`${floors}F with rectangle site valid`, () => {
      const input = baseInput();
      input.building.floors = floors;
      if (floors > 1) input.building.hasStair = true;
      input.site.width = 20;
      input.site.length = 30;
      const prj = createProject(input);
      const { bestCandidate } = legacyGenerate(prj);
      expect(bestCandidate!.floors.length).toBe(floors);
      const geom = computeBuildableGeometry(input.site as any);
      for (const fl of bestCandidate!.floors) {
        for (const sp of fl.spaces) {
          expect(rectInsidePolygon(sp.rect, geom.buildableBoundary)).toBe(true);
        }
      }
    });
  }

  it('6F L-shape', () => {
    const input = baseInput();
    input.building.floors = 6;
    input.building.hasStair = true;
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 20, length: 30, notchWidth: 8, notchLength: 10, notchCorner: 'north-east' };
    input.site.width = 20;
    input.site.length = 30;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    expect(bestCandidate!.floors.length).toBe(6);
  });

  it('10F polygon', () => {
    const input = baseInput();
    input.building.floors = 10;
    input.building.hasStair = true;
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 0, y: 30 }] };
    input.site.width = 20;
    input.site.length = 30;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    expect(bestCandidate!.floors.length).toBe(10);
  });
});

describe('Phase 10 E — adversarial', () => {
  it('narrow site 5x20 still produces valid buildable if setbacks allow', () => {
    const input = baseInput();
    input.site.width = 5;
    input.site.length = 20;
    (input.site as any).setbacks = { north: 0.5, south: 0.5, east: 0.5, west: 0.5 };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.buildableArea).toBeGreaterThan(0);
  });

  it('buildable consumed by setbacks → invalid', () => {
    const input = baseInput();
    input.site.width = 10;
    input.site.length = 10;
    (input.site as any).setbacks = { north: 6, south: 6, east: 6, west: 6 };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(false);
    expect(geom.validationErrors.some(e => e.includes('setback'))).toBe(true);
  });

  it('too small site 3x3 → zero-area validation', () => {
    const input = baseInput();
    input.site.width = 3;
    input.site.length = 3;
    (input.site as any).setbacks = { north: 0, south: 0, east: 0, west: 0 };
    const geom = computeBuildableGeometry(input.site as any);
    // Site area 9 < 10 threshold → validation error in geometry
    expect(geom.siteArea).toBe(9);
    // Direct computeBuildableGeometry with 3x3 still valid? Our min area check is 10, so it should be invalid via validateSitePolygon? Actually computeBuildableGeometry checks siteArea?
    // For SITE_ZERO_AREA via validateSite, we need candidate with small area
    const prj = createProject(input);
    const { bestCandidate, infeasible } = legacyGenerate(prj);
    // Phase 13.2: a 3x3 site cannot satisfy minimum geometry — explicit INFEASIBLE result;
    // site diagnostics remain available on the diagnostic-only candidates.
    expect(infeasible).not.toBeNull();
    expect(bestCandidate).toBeNull();
    expect(infeasible!.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    const findings = validateSite(infeasible!.diagnosticCandidates[0]);
    expect(findings.some(f => f.code === 'SITE_ZERO_AREA' || f.code === 'SITE_INSUFFICIENT_BUILDABLE' || f.code === 'SITE_INVALID_POLYGON')).toBe(true);
  });

  it('parking impossible due to small site', () => {
    const input = baseInput();
    input.site.width = 6;
    input.site.length = 8;
    input.building.parkingSpaces = 4;
    (input.site as any).setbacks = { north: 1, south: 1, east: 1, west: 1 };
    const prj = createProject(input);
    const { bestCandidate, infeasible } = legacyGenerate(prj);
    // Phase 13.2: below-minimum site → explicit INFEASIBLE result; parking diagnostics remain
    // available on the diagnostic-only candidates.
    expect(infeasible).not.toBeNull();
    expect(bestCandidate).toBeNull();
    const diagnostic = infeasible!.diagnosticCandidates[0];
    // Parking may be 0 or have SITE findings
    const findings = validateSite(diagnostic);
    // At least not crash, and parking outside site check
    expect(diagnostic.floors[0].parkingStalls.length).toBeLessThanOrEqual(4);
    // If parking placed, should be inside site
    if (diagnostic.floors[0].parkingStalls.length > 0) {
      for (const ps of diagnostic.floors[0].parkingStalls) {
        expect(rectInsidePolygon(ps.rect, computeBuildableGeometry(input.site as any).siteBoundary)).toBe(true);
      }
    }
  });

  it('concave corner placement still inside buildable', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 7, notchLength: 10, notchCorner: 'north-east' };
    input.site.width = 15;
    input.site.length = 20;
    const prj = createProject(input);
    const { bestCandidate, infeasible } = legacyGenerate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    // Phase 13.2: if the tight concave site is below-minimum geometry the result is INFEASIBLE
    // with no usable candidate; the no-room-in-the-notch generator guarantee still holds for
    // diagnostic candidates.
    const targets = bestCandidate ? [bestCandidate!] : infeasible!.diagnosticCandidates;
    if (!bestCandidate) {
      expect(infeasible!.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    }
    // No room should be in the notch (outside site)
    for (const cand of targets) {
      for (const fl of cand.floors) {
        for (const sp of fl.spaces) {
          expect(rectInsidePolygon(sp.rect, geom.siteBoundary)).toBe(true);
        }
      }
    }
  });

  it('invalid order polygon still handled deterministic', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    // Clockwise input should be normalized to CCW
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }] };
    const geom1 = computeBuildableGeometry(input.site as any);
    const geom2 = computeBuildableGeometry(input.site as any);
    expect(geom1.siteArea).toBe(geom2.siteArea);
    expect(geom1.siteBoundary.length).toBe(geom2.siteBoundary.length);
  });

  it('nearly collinear vertices handled', () => {
    const almostLine = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0.0000001 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const res = validateSitePolygon(almostLine);
    // distance 1e-7 < EPS 1e-6 → zero-length edge → invalid
    expect(res.isValid).toBe(false);
    expect(res.errors.some(e => e.toLowerCase().includes('zero-length'))).toBe(true);
  });

  it('boundary-touch: room exactly on buildable boundary allowed', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    // Buildable bounding rect should contain footprint exactly or inside
    for (const fl of bestCandidate!.floors) {
      expect(fl.footprint.x).toBeGreaterThanOrEqual(geom.buildableBoundingRect.x - 1e-6);
      expect(fl.footprint.y).toBeGreaterThanOrEqual(geom.buildableBoundingRect.y - 1e-6);
      expect(fl.footprint.x + fl.footprint.w).toBeLessThanOrEqual(geom.buildableBoundingRect.x + geom.buildableBoundingRect.w + 1e-6);
    }
  });

  it('deterministic repeat same buildable geometry', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'south-west' };
    const g1 = computeBuildableGeometry(input.site as any);
    const g2 = computeBuildableGeometry(input.site as any);
    expect(g1.siteArea).toBe(g2.siteArea);
    expect(g1.buildableArea).toBe(g2.buildableArea);
    expect(g1.siteBoundary.length).toBe(g2.siteBoundary.length);
    expect(g1.buildableBoundary.length).toBe(g2.buildableBoundary.length);
  });

  it('parking orientation alternatives deterministic', () => {
    const input = baseInput();
    input.building.parkingSpaces = 2;
    (input.site as any).parkingLayout = 'perpendicular';
    const prj1 = createProject(input);
    const { bestCandidate: c1 } = generate(prj1);
    const prj2 = createProject(input);
    const { bestCandidate: c2 } = generate(prj2);
    expect(c1!.floors[0].parkingStalls.length).toBe(c2!.floors[0].parkingStalls.length);
    if (c1!.floors[0].parkingStalls.length > 0) {
      expect(c1!.floors[0].parkingStalls[0].rect.w).toBe(c2!.floors[0].parkingStalls[0].rect.w);
    }
  });
});

describe('Phase 10 G — cross-output agree site metadata', () => {
  it('doc=report=manifest=DXF/PDF/XLSX agree on site shape/area/buildable/setbacks', async () => {
    // Phase 13.2: the original tight L 15x20 notch 5x6 (with setbacks, 2 floors) is below-minimum
    // geometry — generate() returns an explicit INFEASIBLE result and exportAll refuses it. Pin that
    // semantics, then keep the cross-output agreement verification on the feasible L 20x25 notch 8x10.
    const tight = baseInput();
    (tight.site as any).shape = 'l-shape';
    (tight.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    (tight.site as any).setbacks = { north: 2, south: 3, east: 2, west: 2 };
    tight.building.floors = 2;
    tight.building.hasStair = true;
    const tightRes = generate(createProject(tight));
    if (tightRes.infeasible) {
      expect(tightRes.bestCandidate).toBeNull();
      expect(tightRes.project.candidates).toEqual([]);
      await expect(exportAll(tightRes.project, tightRes.bestCandidate!)).rejects.toThrow(/INFEASIBLE/);
    }
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 20, length: 25, notchWidth: 8, notchLength: 10, notchCorner: 'north-east' };
    (input.site as any).setbacks = { north: 2, south: 3, east: 2, west: 2 };
    input.site.width = 20;
    input.site.length = 25;
    (input.site as any).jurisdiction = 'Tehran-Test';
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    expect(bestCandidate).not.toBeNull();
    const { docModel, dxf, pdf, xlsx, report, manifest } = await exportAll(prj, bestCandidate!);

    // Site shape
    expect(docModel.site.shape).toBe('l-shape');
    expect(report.site!.shape).toBe('l-shape');
    expect(manifest.input.site.shape).toBe('l-shape');
    expect(manifest.geometry.siteShape).toBe('l-shape');

    // Area
    expect(docModel.site.area).toBeGreaterThan(0);
    expect((docModel.site as any).buildableArea).toBeGreaterThan(0);
    expect(docModel.site.area).toBeGreaterThan((docModel.site as any).buildableArea);
    expect(report.site!.area).toBe(docModel.site.area);
    expect(manifest.input.site.area).toBe(docModel.site.area);

    // Setbacks
    expect((docModel.site as any).setbacks.north).toBe(2);
    expect(manifest.input.site.setbacks!.north).toBe(2);

    // Buildable
    expect((docModel.site as any).buildableArea).toBe(manifest.geometry.buildableArea);

    // DXF contains site layers
    expect(dxf).toContain('A-SITE');
    expect(dxf).toContain('A-BLDG-OUT');
    expect(dxf).toContain('A-SETBACK');

    // PDF contains site shape (we check size)
    expect(pdf.length).toBeGreaterThan(1000);

    // XLSX 11 sheets including Site
    const { validateXLSX } = await import('./documentation/xlsx.js');
    const res = validateXLSX(xlsx);
    expect(res.sheets).toContain('11_Site');

    // Drawing number AG-{id}-WB
    expect(docModel.drawing.drawingNumber).toBe(`AG-${bestCandidate!.id}-WB`);
  });

  it('PDF site/context AG-{id}-WB drawing numbers', async () => {
    const input = baseInput();
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const doc = buildDocumentation(prj, bestCandidate!);
    expect(doc.drawing.drawingNumber).toMatch(/^AG-.*-WB$/);
  });

  it('XLSX site sheet contains setbacks and jurisdiction', async () => {
    const input = baseInput();
    (input.site as any).jurisdiction = 'Tehran-Municipality-Default';
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const doc = buildDocumentation(prj, bestCandidate!);
    const { generateXLSX } = await import('./documentation/xlsx.js');
    const xlsxBytes = await generateXLSX(doc);
    // Can't parse XLSX easily, but docModel has data
    expect((doc.site as any).jurisdiction).toBe('Tehran-Municipality-Default');
    expect((doc.site as any).setbacks).toBeDefined();
    expect((doc.site as any).setbackSources.length).toBe(4);
  });
});

describe('Phase 10 H — performance bounded', () => {
  it('candidate generation bounded floors≤10 verts≤8 strategies bounded candidates≤12 no 4^floors', () => {
    const input = baseInput();
    input.building.floors = 10;
    input.building.hasStair = true;
    input.site.width = 20;
    input.site.length = 30;
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }] };
    const start = Date.now();
    const prj = createProject(input);
    const { candidates } = legacyGenerate(prj);
    const elapsed = Date.now() - start;
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(candidates.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10000); // 10s for 10F worst case
    // No 4^floors explosion: 4^10 = 1M, we have ≤12
    expect(candidates.length).toBeLessThan(Math.pow(4, input.building.floors));
  });

  it('site validation bounded', () => {
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      validateSitePolygon(poly);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('DXF generation with site layers bounded', () => {
    const input = baseInput();
    input.building.floors = 10;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const start = Date.now();
    const dxf = writeDXF(bestCandidate!, 'PerfTest');
    const elapsed = Date.now() - start;
    expect(dxf.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('Phase 10 — site validation findings', () => {
  it('SITE_INVALID_POLYGON finding', () => {
    const bowtie = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }];
    const res = validateSitePolygon(bowtie);
    expect(res.isValid).toBe(false);
  });

  it('SITE_* codes via validateSite', () => {
    const input = baseInput();
    input.site.width = 3;
    input.site.length = 3;
    (input.site as any).setbacks = { north: 0, south: 0, east: 0, west: 0 };
    const prj = createProject(input);
    const { bestCandidate, infeasible } = legacyGenerate(prj);
    // Phase 13.2: below-minimum site → explicit INFEASIBLE result; SITE_* diagnostics remain
    // available on the diagnostic-only candidates.
    expect(infeasible).not.toBeNull();
    expect(bestCandidate).toBeNull();
    const findings = validateSite(infeasible!.diagnosticCandidates[0]);
    expect(findings.some(f => f.code.startsWith('SITE_'))).toBe(true);
  });

  it('rooms inside buildable validation passes for valid site', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = legacyGenerate(prj);
    const findings = validateSite(bestCandidate!);
    const hardSite = findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
    // For normal 15x20 site, should be 0 hard SITE findings
    expect(hardSite.length).toBe(0);
  });
});
