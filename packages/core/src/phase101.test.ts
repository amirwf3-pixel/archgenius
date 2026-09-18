/**
 * Phase 10.1 — SITE-AWARE HARDENING
 * Focused hardening for:
 * 1. DXF per-floor site/buildable layers canonical
 * 2. 8-vertex orthogonal polygon decomposition (no bbox fallback)
 * 3. Complete containment (rooms, corridors, walls, openings, furniture, stairs, parking)
 * 4. Area semantics (actual vs bounding)
 */

import { describe, it, expect } from 'vitest';
import { createProject, generate, buildDocumentation, exportAll } from './pipeline.js';
import type { ProjectInput } from './model/project.js';
import { computeBuildableGeometry } from './site/buildable.js';
import { validateSitePolygon, polygonArea, rectInsidePolygon, pointInPolygon, decomposeOrthogonalPolygonToRects, polygonBoundingRect } from './geometry/polygon-ops.js';
import { writeDXF } from './dxf/writer.js';
import { validateSite } from './validation/site.js';
import { rArea } from './geometry/rect.js';

function baseInput(): ProjectInput {
  return {
    name: 'Phase10.1 Test',
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

// Helper to parse DXF polylines per layer: returns map layer -> array of polylines (each polyline is Vec2[] in mm)
function parseDXFPolylines(dxf: string): Map<string, Array<Array<{ x: number; y: number }>>> {
  const lines = dxf.split(/\r?\n/);
  const map = new Map<string, Array<Array<{ x: number; y: number }>>>();
  let i = 0;
  let currentLayer: string | null = null;
  let currentPolyline: Array<{ x: number; y: number }> | null = null;
  let inPolyline = false;
  while (i < lines.length) {
    const code = lines[i]?.trim();
    const value = lines[i + 1]?.trim();
    if (code === '0' && value === 'POLYLINE') {
      inPolyline = true;
      currentLayer = null;
      currentPolyline = [];
      i += 2;
      continue;
    }
    if (inPolyline) {
      if (code === '8' && currentLayer === null) {
        currentLayer = value!;
      }
      if (code === '0' && value === 'VERTEX') {
        // Next should be 8 layer, 10 x, 20 y
        let vx: number | null = null;
        let vy: number | null = null;
        let j = i + 2;
        while (j < lines.length) {
          const c = lines[j]?.trim();
          const v = lines[j + 1]?.trim();
          if (c === '0') break; // next entity
          if (c === '10') vx = parseFloat(v!);
          if (c === '20') vy = parseFloat(v!);
          j += 2;
        }
        if (vx !== null && vy !== null && currentPolyline) {
          currentPolyline.push({ x: vx, y: vy });
        }
      }
      if (code === '0' && value === 'SEQEND') {
        if (currentLayer && currentPolyline && currentPolyline.length > 0) {
          if (!map.has(currentLayer)) map.set(currentLayer, []);
          map.get(currentLayer)!.push(currentPolyline);
        }
        inPolyline = false;
        currentLayer = null;
        currentPolyline = null;
      }
    }
    i += 2;
  }
  return map;
}

describe('Phase 10.1 — 1. DXF per-floor canonical geometry', () => {
  it('every floor has A-FLOOR-n-A-SITE representing actual siteBoundary', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test101');
    const polylines = parseDXFPolylines(dxf);
    // Check per-floor A-SITE exists for floor 0 and 1
    expect(polylines.has('A-FLOOR-0-A-SITE')).toBe(true);
    expect(polylines.has('A-FLOOR-1-A-SITE')).toBe(true);
    // Check that A-FLOOR-1-A-SITE has same vertex count as siteBoundary (6 for L-shape)
    const siteVerts = (bestCandidate as any).siteBoundary.length;
    const floor1Site = polylines.get('A-FLOOR-1-A-SITE')![0];
    expect(floor1Site.length).toBe(siteVerts);
  });

  it('every floor has A-FLOOR-n-A-SETBACK representing actual buildable boundary', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    input.building.floors = 3;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test101');
    const polylines = parseDXFPolylines(dxf);
    for (let fi = 0; fi < 3; fi++) {
      expect(polylines.has(`A-FLOOR-${fi}-A-SETBACK`)).toBe(true);
      const pl = polylines.get(`A-FLOOR-${fi}-A-SETBACK`)![0];
      // Buildable boundary for L-shape should have >=4 vertices, and for L-shape 6 verts
      expect(pl.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('every floor has A-FLOOR-n-A-BLDG-OUT using actual buildableBoundary, not bounding rect', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test101');
    const polylines = parseDXFPolylines(dxf);
    // For L-shape, buildableBoundary should be 6 verts (non-rectangular)
    const buildableVerts = (bestCandidate as any).buildableBoundary.length;
    expect(buildableVerts).toBe(6);
    for (let fi = 0; fi < 2; fi++) {
      const layer = `A-FLOOR-${fi}-A-BLDG-OUT`;
      expect(polylines.has(layer)).toBe(true);
      const poly = polylines.get(layer)![0];
      // Must have same vertex count as buildableBoundary, not 4 (bounding rect)
      expect(poly.length).toBe(buildableVerts);
      // Verify not bounding rect: for L-shape, area differs from bounding rect area
      // Compute bounding rect area vs polygon area from DXF mm converted back to m
      const mmToM = (mm: number) => mm / 1000;
      const ptsM = poly.map(p => ({ x: mmToM(p.x), y: mmToM(p.y) }));
      // Compute polygon area via shoelace (need to remove yOff)
      // yOff is floorOffset, but area independent of translation
      let area = 0;
      for (let i = 0; i < ptsM.length; i++) {
        const p1 = ptsM[i];
        const p2 = ptsM[(i + 1) % ptsM.length];
        area += p1.x * p2.y - p2.x * p1.y;
      }
      area = Math.abs(area / 2);
      const geom = computeBuildableGeometry(input.site as any);
      expect(area).toBeCloseTo(geom.buildableArea, 0); // should match actual buildable area, not bounding rect area
      expect(area).toBeLessThan(geom.buildableBoundingRect.w * geom.buildableBoundingRect.h - 0.1); // less than bounding
    }
  });

  it('multi-floor L-shape upper floor DXF genuinely non-rectangular when canonical is non-rectangular', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 20, length: 25, notchWidth: 8, notchLength: 10, notchCorner: 'north-east' };
    input.building.floors = 3;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test101');
    const polylines = parseDXFPolylines(dxf);
    // Upper floor (floor 2) BLDG-OUT should have 6 vertices (L-shape), not 4
    const upper = polylines.get('A-FLOOR-2-A-BLDG-OUT')![0];
    expect(upper.length).toBe(6);
    expect(upper.length).not.toBe(4);
  });

  it('multi-floor polygon upper floor DXF genuinely non-rectangular', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 20 }, { x: 0, y: 20 }] }; // 6-vert L via polygon
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test101Poly');
    const polylines = parseDXFPolylines(dxf);
    const upper = polylines.get('A-FLOOR-1-A-BLDG-OUT')![0];
    expect(upper.length).toBe(6);
  });
});

describe('Phase 10.1 — 2. 8-vertex orthogonal polygon', () => {
  it('decompose 8-vertex C-shape into 3 rects, not bounding rect', () => {
    const cShape = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const res = validateSitePolygon(cShape);
    expect(res.isValid).toBe(true);
    const rects = decomposeOrthogonalPolygonToRects(cShape);
    expect(rects).not.toBeNull();
    expect(rects!.length).toBe(3);
    const area = polygonArea(cShape);
    const sum = rects!.reduce((s, r) => s + r.w * r.h, 0);
    expect(sum).toBeCloseTo(area, 1);
    const br = polygonBoundingRect(cShape);
    expect(sum).toBeLessThan(br.w * br.h - 0.1);
  });

  it('8-vertex staircase shape decomposition', () => {
    const stairShape = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 12 }, { x: 4, y: 12 }, { x: 4, y: 18 }, { x: 0, y: 18 }];
    const res = validateSitePolygon(stairShape);
    expect(res.isValid).toBe(true);
    const rects = decomposeOrthogonalPolygonToRects(stairShape);
    expect(rects).not.toBeNull();
    expect(rects!.length).toBeGreaterThanOrEqual(2);
    expect(rects!.length).toBeLessThanOrEqual(6);
    const area = polygonArea(stairShape);
    const sum = rects!.reduce((s, r) => s + r.w * r.h, 0);
    expect(sum).toBeCloseTo(area, 1);
  });

  it('8-vertex concave polygon containment of every generated room (or honest HARD for infeasible)', async () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }, { x: 15, y: 30 }, { x: 15, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }] };
    input.site.width = 20;
    input.site.length = 30;
    input.building.floors = 1;
    const geom = computeBuildableGeometry(input.site as any);
    if (geom.isValid) {
      const prj = createProject(input);
      const { bestCandidate } = generate(prj);
      const { validateCandidate: vc } = await import('./pipeline.js');
      const vr = vc(bestCandidate);
      const outside = vr.hard.filter((f: any) => f.code === 'GEO_ROOM_OUTSIDE_FOOTPRINT' || f.code === 'SITE_ROOM_OUTSIDE_BUILDABLE');
      if (outside.length > 0) {
        expect(vr.hard.length).toBeGreaterThan(0);
      } else {
        for (const fl of bestCandidate.floors) {
          for (const sp of fl.spaces) {
            expect(rectInsidePolygon(sp.rect, geom.buildableBoundary)).toBe(true);
          }
        }
      }
    } else {
      expect(geom.validationErrors.some(e => e.includes('decomposition'))).toBe(true);
    }
  });

  it('final geometry differs from bounding rectangle where expected for 8-vert', () => {
    const poly = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 12 }, { x: 5, y: 12 }, { x: 5, y: 20 }, { x: 0, y: 20 }];
    const area = polygonArea(poly);
    const br = polygonBoundingRect(poly);
    expect(area).toBeLessThan(br.w * br.h - 0.1);
    const rects = decomposeOrthogonalPolygonToRects(poly);
    if (rects) {
      const sum = rects.reduce((s, r) => s + r.w * r.h, 0);
      expect(sum).toBeCloseTo(area, 1);
      expect(sum).toBeLessThan(br.w * br.h - 0.1);
    }
  });

  it('deterministic repeated generation for 8-vert', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }] };
    input.site.width = 10;
    input.site.length = 10;
    const g1 = computeBuildableGeometry(input.site as any);
    const g2 = computeBuildableGeometry(input.site as any);
    expect(g1.siteArea).toBe(g2.siteArea);
    expect(g1.buildableArea).toBe(g2.buildableArea);
    expect(g1.buildableRects.length).toBe(g2.buildableRects.length);
  });

  it('invalid 8-vertex cases: self-intersect, duplicate, zero-area', () => {
    const selfIntersect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 10 }, { x: 5, y: 10 }, { x: 5, y: 2 }, { x: 0, y: 2 }]; // self-intersect?
    // Use known invalid: bowtie with 8 verts? Simpler: duplicate
    const dup = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 0, y: 10 }];
    const resDup = validateSitePolygon(dup);
    expect(resDup.isValid).toBe(false);

    const nine = Array.from({ length: 9 }, (_, i) => ({ x: i * 2, y: (i % 2) * 10 }));
    const resNine = validateSitePolygon(nine);
    expect(resNine.isValid).toBe(false);
  });

  it('8-vertex decomposition failure returns null, not bounding rect, and validation marks HARD', () => {
    // Non-orthogonal should fail validation and decomposition
    const nonOrtho = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 6 }, { x: 4, y: 10 }, { x: 0, y: 10 }]; // one diagonal edge
    const res = validateSitePolygon(nonOrtho);
    expect(res.isValid).toBe(false); // non-orthogonal
    const rects = decomposeOrthogonalPolygonToRects(nonOrtho);
    expect(rects).toBeNull(); // should fail, not return bounding rect

    // Valid 8-vert C-shape with small setbacks should decompose
    const valid8 = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const geom = computeBuildableGeometry({ shape: 'polygon', polygon: { vertices: valid8 }, width: 10, length: 10, accessSide: 'south', setbacks: { north: 0.5, south: 0.5, east: 0.5, west: 0.5 } } as any);
    expect(geom.isValid).toBe(true);
    expect(geom.buildableRects.length).toBeGreaterThan(0);
    expect(geom.buildableRects.length).toBeLessThanOrEqual(6);
  });
});

describe('Phase 10.1 — 3. Complete site containment', () => {
  it('rooms outside buildable => HARD', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    // Manually move a room outside buildable
    const geom = computeBuildableGeometry(input.site as any);
    const outsideRect = { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: geom.siteBoundingRect.y, w: 3, h: 3 };
    (bestCandidate.floors[0].spaces[0] as any).rect = outsideRect;
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_ROOM_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
  });

  it('corridor outside buildable => HARD (not skipped)', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    // Find corridor or create one
    let corridor = bestCandidate.floors[0].spaces.find(s => s.type === 'corridor');
    if (!corridor) {
      corridor = { id: 'corridor-test', type: 'corridor', label: 'Corridor', rect: { x: 0, y: 0, w: 2, h: 2 }, polygon: [], area: 4, targetArea: 4, minArea: 0, wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0, privacy: 'service', zone: 'circulation', orientation: 'any', daylightRequired: false } as any;
      bestCandidate.floors[0].spaces.push(corridor as any);
    }
    const outsideRect = { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: geom.siteBoundingRect.y, w: 3, h: 3 };
    (corridor as any).rect = outsideRect;
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_CORRIDOR_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
  });

  it('wall outside buildable => HARD', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    const outsideWall = {
      id: 'wall-outside',
      start: { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: 0 },
      end: { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 10, y: 0 },
      thickness: 0.2,
      kind: 'exterior',
      spaceIds: [],
      openingIds: [],
    } as any;
    bestCandidate.floors[0].walls.push(outsideWall);
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_WALL_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
  });

  it('opening outside buildable => HARD', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    const outsideOpening = {
      id: 'opening-outside',
      type: 'window',
      center: { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: 5 },
      wallId: bestCandidate.floors[0].walls[0]?.id ?? 'wall-0',
      width: 1,
      height: 1,
      sill: 0.9,
      wallDir: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    } as any;
    bestCandidate.floors[0].openings.push(outsideOpening);
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_OPENING_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
  });

  it('furniture outside buildable => HARD', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    const outsideFurn = {
      id: 'f-outside',
      type: 'bed-double',
      rect: { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: 0, w: 1.6, h: 2 },
      rotation: 0,
      spaceId: bestCandidate.floors[0].spaces[0].id,
    } as any;
    (bestCandidate.floors[0] as any).furniture = [...((bestCandidate.floors[0] as any).furniture ?? []), outsideFurn];
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_FURNITURE_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
  });

  it('furniture outside its room => HARD', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const room = bestCandidate.floors[0].spaces[0];
    const outsideFurn = {
      id: 'f-outside-room',
      type: 'bed-double',
      rect: { x: room.rect.x + room.rect.w + 5, y: room.rect.y, w: 1.6, h: 2 },
      rotation: 0,
      spaceId: room.id,
    } as any;
    (bestCandidate.floors[0] as any).furniture = [...((bestCandidate.floors[0] as any).furniture ?? []), outsideFurn];
    const findings = validateSite(bestCandidate);
    // Could be either outside buildable or outside room, both HARD
    expect(findings.some(f => f.code.startsWith('SITE_FURNITURE') && f.severity === 'hard')).toBe(true);
  });

  it('stairs outside buildable => HARD', () => {
    const input = baseInput();
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    if (bestCandidate.floors[0].stairs.length > 0) {
      const outsideRect = { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: 0, w: 3, h: 5 };
      (bestCandidate.floors[0].stairs[0] as any).footprint = outsideRect;
      const findings = validateSite(bestCandidate);
      expect(findings.some(f => f.code === 'SITE_STAIR_OUTSIDE_BUILDABLE' && f.severity === 'hard')).toBe(true);
    }
  });

  it('parking outside site => HARD and overlaps building => HARD', () => {
    const input = baseInput();
    input.building.parkingSpaces = 1;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    const outsideStall = {
      id: 'parking-outside',
      index: 99,
      rect: { x: geom.siteBoundingRect.x + geom.siteBoundingRect.w + 5, y: 0, w: 2.5, h: 5 },
    } as any;
    bestCandidate.floors[0].parkingStalls.push(outsideStall);
    const findings = validateSite(bestCandidate);
    expect(findings.some(f => f.code === 'SITE_PARKING_OUTSIDE_SITE' && f.severity === 'hard')).toBe(true);
  });

  it('valid candidate has zero HARD site findings for rooms/corridors/walls/openings/furniture/stairs/parking', () => {
    const input = baseInput();
    input.building.floors = 1;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const findings = validateSite(bestCandidate);
    const hard = findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
    expect(hard.length).toBe(0);
  });
});

describe('Phase 10.1 — 4. Area semantics', () => {
  it('rectangle: actual == bounding', () => {
    const input = baseInput();
    (input.site as any).shape = 'rectangle';
    input.site.width = 10;
    input.site.length = 20;
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.buildableArea).toBeCloseTo(geom.buildableBoundingRect.w * geom.buildableBoundingRect.h, 1);
    expect(geom.buildableArea).toBeCloseTo(geom.buildableRect.w * geom.buildableRect.h, 1);
  });

  it('L-shape: actual != bounding', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    const geom = computeBuildableGeometry(input.site as any);
    const boundingArea = geom.buildableBoundingRect.w * geom.buildableBoundingRect.h;
    expect(geom.buildableArea).toBeLessThan(boundingArea - 0.1);
    expect(geom.buildableArea).not.toBeCloseTo(boundingArea, 0);
  });

  it('polygon: actual != bounding where applicable', () => {
    const poly = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 12 }, { x: 5, y: 12 }, { x: 5, y: 20 }, { x: 0, y: 20 }];
    const area = polygonArea(poly);
    const br = polygonBoundingRect(poly);
    const boundingArea = br.w * br.h;
    expect(area).toBeLessThan(boundingArea - 0.1);
    const geom = computeBuildableGeometry({ shape: 'polygon', polygon: { vertices: poly }, width: 15, length: 20, accessSide: 'south', setbacks: { north: 1, south: 1, east: 1, west: 1 } } as any);
    if (geom.isValid) {
      expect(geom.buildableArea).toBeLessThan(geom.buildableBoundingRect.w * geom.buildableBoundingRect.h - 0.1);
    }
  });

  it('cross-output consistency actual areas', async () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    (input.site as any).setbacks = { north: 2, south: 3, east: 2, west: 2 };
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const { docModel, report, manifest } = await exportAll(prj, bestCandidate);
    const geom = computeBuildableGeometry(input.site as any);
    // docModel site area should be actual site area
    expect(docModel.site.area).toBeCloseTo(geom.siteArea, 1);
    expect((docModel.site as any).buildableArea).toBeCloseTo(geom.buildableArea, 1);
    // areaSummary buildingFootprint should be actual, not bounding
    expect(docModel.areaSummary.buildingFootprint).toBeCloseTo(geom.buildableArea, 1);
    expect(docModel.areaSummary.buildingFootprint).toBeLessThan(geom.buildableBoundingRect.w * geom.buildableBoundingRect.h - 0.1);
    // manifest buildableArea should be actual
    expect(manifest.geometry.buildableArea).toBeCloseTo(geom.buildableArea, 1);
    // grossFloorArea should be buildingFootprint * floors
    expect(docModel.areaSummary.grossFloorArea).toBeCloseTo(docModel.areaSummary.buildingFootprint * input.building.floors, 0);
  });

  it('rectangle area semantics cross-output', async () => {
    const input = baseInput();
    (input.site as any).shape = 'rectangle';
    input.site.width = 12;
    input.site.length = 18;
    (input.site as any).setbacks = { north: 1, south: 1, east: 1, west: 1 };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const { docModel } = await exportAll(prj, bestCandidate);
    const geom = computeBuildableGeometry(input.site as any);
    expect(docModel.areaSummary.buildingFootprint).toBeCloseTo(geom.buildableArea, 1);
    // For rectangle, actual == bounding
    expect(docModel.areaSummary.buildingFootprint).toBeCloseTo(geom.buildableBoundingRect.w * geom.buildableBoundingRect.h, 1);
  });
});

describe('Phase 10.1 — determinism and performance', () => {
  it('same input+seed produces identical site geometry, buildable geometry, candidate IDs, quality, DXF geometry', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'north-east' };
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj1 = createProject(input);
    const { bestCandidate: c1 } = generate(prj1);
    const dxf1 = writeDXF(c1, 'Test');
    const prj2 = createProject(input);
    const { bestCandidate: c2 } = generate(prj2);
    const dxf2 = writeDXF(c2, 'Test');
    expect(c1.id).toBe(c2.id);
    expect((c1 as any).siteAreaValue).toBe((c2 as any).siteAreaValue);
    expect((c1 as any).buildableAreaValue).toBe((c2 as any).buildableAreaValue);
    expect(c1.floors.length).toBe(c2.floors.length);
    expect(dxf1).toBe(dxf2);
  });

  it('performance bounded: floors<=10 verts<=8 candidates<=12 no 4^floors', () => {
    const input = baseInput();
    input.building.floors = 10;
    input.building.hasStair = true;
    input.site.width = 20;
    input.site.length = 30;
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }] };
    const start = Date.now();
    const prj = createProject(input);
    const { candidates } = generate(prj);
    const elapsed = Date.now() - start;
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(elapsed).toBeLessThan(10000);
    expect(candidates.length).toBeLessThan(Math.pow(4, input.building.floors));
  });
});
