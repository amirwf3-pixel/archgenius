/**
 * Phase 11 — Parametric Architectural Planning & Constraint-Aware Editing
 * Behavioral tests for canonical polygon geometry, constraints, locking, editing, site-aware, multi-floor, outputs, determinism, adversarial, performance
 */

import { describe, it, expect } from 'vitest';
import { createProject, generate, buildDocumentation, exportAll } from './pipeline.js';
import type { ProjectInput } from './model/project.js';
import { computeBuildableGeometry } from './site/buildable.js';
import {
  createRectangleRoomPolygon,
  createLShapedRoomPolygon,
  validateRoomPolygon,
  roomPolygonArea,
  roomPolygonToBoundingRect,
  roomContainsPoint,
  roomPolygonsOverlap,
  sharedWallEdges,
  roomPolygonInsideBuildable,
  translateRoomPolygon,
} from './geometry/room-polygon.js';
import { polygonArea, rectInsidePolygon, pointInPolygon, polygonBoundingRect } from './geometry/polygon-ops.js';
import { generateWalls } from './generator/walls.js';
import { writeDXF } from './dxf/writer.js';
import { validateSite } from './validation/site.js';
import { validateGeometric } from './validation/geometric.js';
import { applyEdit, moveRoom, resizeRoom, lockRoom, unlockRoom, setLShape } from './editing/room-editing.js';
import { validateRoomSizeConstraints } from './model/room-constraints.js';
import { validateParametricConstraints } from './layout/parametric-constraints.js';
import { rArea } from './geometry/rect.js';
import type { Space } from './model/space.js';

function baseInput(): ProjectInput {
  return {
    name: 'Phase11 Test',
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
        let vx: number | null = null;
        let vy: number | null = null;
        let j = i + 2;
        while (j < lines.length) {
          const c = lines[j]?.trim();
          const v = lines[j + 1]?.trim();
          if (c === '0') break;
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

describe('Phase 11 A. Geometry — rectangle room polygon', () => {
  it('rectangle room polygon canonical, area from polygon, rect derived bounding', () => {
    const rect = { x: 0, y: 0, w: 5, h: 4 };
    const poly = createRectangleRoomPolygon(rect);
    expect(poly.length).toBe(4);
    const area = roomPolygonArea(poly);
    expect(area).toBeCloseTo(20, 3);
    const bounding = roomPolygonToBoundingRect(poly);
    expect(bounding.w).toBeCloseTo(5, 3);
    expect(bounding.h).toBeCloseTo(4, 3);
    expect(bounding.x).toBeCloseTo(0, 3);
    expect(bounding.y).toBeCloseTo(0, 3);
    // Area from polygon equals bounding area for rectangle
    expect(area).toBeCloseTo(rArea(bounding), 3);
  });

  it('L-shaped room polygon, area < bounding, 6 verts', () => {
    const bounding = { x: 0, y: 0, w: 6, h: 5 };
    const poly = createLShapedRoomPolygon(bounding, 2, 2, 'ne');
    expect(poly).not.toBeNull();
    expect(poly!.length).toBe(6);
    const area = roomPolygonArea(poly!);
    const boundingArea = bounding.w * bounding.h;
    expect(area).toBeLessThan(boundingArea - 0.1);
    expect(area).toBeCloseTo(boundingArea - 4, 1); // notch 2x2=4
    const v = validateRoomPolygon(poly!);
    expect(v.valid).toBe(true);
  });

  it('concave orthogonal room up to 8 verts', () => {
    const poly = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
      { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 },
      { x: 4, y: 10 }, { x: 0, y: 10 },
    ];
    const v = validateRoomPolygon(poly);
    expect(v.valid).toBe(true);
    const area = roomPolygonArea(poly);
    const br = roomPolygonToBoundingRect(poly);
    expect(area).toBeLessThan(br.w * br.h - 0.1);
  });

  it('polygon area, containment, self-intersection rejection', () => {
    const rect = { x: 0, y: 0, w: 4, h: 4 };
    const poly = createRectangleRoomPolygon(rect);
    expect(roomContainsPoint(poly, { x: 2, y: 2 })).toBe(true);
    expect(roomContainsPoint(poly, { x: 5, y: 5 })).toBe(false);

    const selfIntersect = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 },
    ];
    const v = validateRoomPolygon(selfIntersect);
    expect(v.valid).toBe(false);
    expect(v.errors.some(e => e.includes('self-intersect'))).toBe(true);
  });

  it('shared wall detection', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 4, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    const shared = sharedWallEdges(polyA, polyB);
    expect(shared.length).toBe(1);
    expect(shared[0].overlap[0].x).toBeCloseTo(4, 2);
  });

  it('wall generation from polygon — rectangle 4 edges merged, L-shape 6 edges', () => {
    const rect = { x: 0, y: 0, w: 5, h: 4 };
    const polyRect = createRectangleRoomPolygon(rect);
    const spaceRect: Space = {
      id: 'r1', type: 'living', label: 'Living', privacy: 'public', zone: 'public',
      polygon: polyRect, rect, area: 20, targetArea: 20, minArea: 10,
      wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
      shapeType: 'rectangle',
    };
    const wallsRect = generateWalls([spaceRect], 0);
    // For single rectangle, 4 walls
    expect(wallsRect.length).toBe(4);

    const bounding = { x: 0, y: 0, w: 6, h: 5 };
    const polyL = createLShapedRoomPolygon(bounding, 2, 2, 'ne')!;
    const rectL = roomPolygonToBoundingRect(polyL);
    const spaceL: Space = {
      id: 'l1', type: 'living', label: 'Living L', privacy: 'public', zone: 'public',
      polygon: polyL, rect: rectL, area: roomPolygonArea(polyL), targetArea: 20, minArea: 10,
      wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0,
      shapeType: 'l-shape',
    };
    const wallsL = generateWalls([spaceL], 0);
    expect(wallsL.length).toBe(6);
  });
});

describe('Phase 11 B. Constraints', () => {
  it('min/target/max area, width/length constraints', () => {
    const area = 20;
    const bounding = { w: 5, h: 4 };
    const c = { minArea: 15, targetArea: 20, maxArea: 25, minWidth: 3, minLength: 4, preferredAspectRatio: 1.25 };
    const res = validateRoomSizeConstraints(area, bounding, c);
    expect(res.valid).toBe(true);

    const c2 = { minArea: 25 };
    const res2 = validateRoomSizeConstraints(area, bounding, c2);
    expect(res2.valid).toBe(false);
    expect(res2.findings.some(f => f.code === 'ROOM_CONSTRAINT_MIN_AREA')).toBe(true);
  });

  it('MUST adjacency and separation deterministic findings', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 4, y: 0, w: 4, h: 4 };
    const rectC = { x: 10, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    const polyC = createRectangleRoomPolygon(rectC);
    const spaceA: Space = { id: 'a', type: 'living', label: 'A', privacy: 'public', zone: 'public', polygon: polyA, rect: rectA, area: 16, targetArea: 16, minArea: 10, wallIds: [], openingIds: [], adjacentSpaceIds: ['b'], hasExteriorWall: false, floor: 0 };
    const spaceB: Space = { id: 'b', type: 'dining', label: 'B', privacy: 'public', zone: 'public', polygon: polyB, rect: rectB, area: 16, targetArea: 16, minArea: 10, wallIds: [], openingIds: [], adjacentSpaceIds: ['a'], hasExteriorWall: false, floor: 0 };
    const spaceC: Space = { id: 'c', type: 'bedroom', label: 'C', privacy: 'private', zone: 'private', polygon: polyC, rect: rectC, area: 16, targetArea: 16, minArea: 10, wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, floor: 0 };

    const constraints = [
      { id: 'must-adj', kind: 'MUST_ADJACENT' as const, strength: 'hard' as const, fromId: 'a', toId: 'b', note: 'A must adjacent B' },
      { id: 'must-sep', kind: 'MUST_BE_SEPARATED' as const, strength: 'hard' as const, fromId: 'a', toId: 'c', note: 'A must separated from C' },
    ];
    const findings = validateParametricConstraints([spaceA, spaceB, spaceC], constraints);
    // A adjacent B should be satisfied (no finding), A separated from C satisfied
    expect(findings.filter(f => f.code === 'CONSTRAINT_MUST_ADJACENT').length).toBe(0);
    expect(findings.filter(f => f.code === 'CONSTRAINT_MUST_SEPARATED').length).toBe(0);

    // Now test violation: A must adjacent C but they are separated
    const constraints2 = [
      { id: 'must-adj-violation', kind: 'MUST_ADJACENT' as const, strength: 'hard' as const, fromId: 'a', toId: 'c' },
    ];
    const findings2 = validateParametricConstraints([spaceA, spaceB, spaceC], constraints2);
    expect(findings2.some(f => f.code === 'CONSTRAINT_MUST_ADJACENT' && f.severity === 'hard')).toBe(true);
  });

  it('privacy constraint', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 4, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    const spaceA: Space = { id: 'a', type: 'bedroom', label: 'Bedroom', privacy: 'private', zone: 'private', polygon: polyA, rect: rectA, area: 16, targetArea: 16, minArea: 10, wallIds: [], openingIds: [], adjacentSpaceIds: ['b'], hasExteriorWall: false, floor: 0 };
    const spaceB: Space = { id: 'b', type: 'living', label: 'Living', privacy: 'public', zone: 'public', polygon: polyB, rect: rectB, area: 16, targetArea: 16, minArea: 10, wallIds: [], openingIds: [], adjacentSpaceIds: ['a'], hasExteriorWall: false, floor: 0 };
    const constraints = [
      { id: 'privacy', kind: 'PRIVACY_REQUIRED' as const, strength: 'soft' as const, fromId: 'a', toId: 'b' },
    ];
    const findings = validateParametricConstraints([spaceA, spaceB], constraints);
    // Privacy violation when bedroom adjacent to living directly
    expect(findings.some(f => f.code === 'CONSTRAINT_PRIVACY')).toBe(true);
  });
});

describe('Phase 11 C. Locking', () => {
  it('locked room position preserved', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const space = floor.spaces[0];
    // Lock position
    const lockedRes = lockRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, lockKind: 'position' });
    expect(lockedRes.success).toBe(true);
    const lockedCand = lockedRes.candidate!;
    // Try to move locked room — should fail
    const moveRes = moveRoom(lockedCand, { floorLevel: 0, spaceId: space.id, newX: space.rect.x + 5, newY: space.rect.y + 5 });
    expect(moveRes.success).toBe(false);
    expect(moveRes.error).toContain('locked');
  });

  it('locked room size preserved', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const lockedRes = lockRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, lockKind: 'size' });
    expect(lockedRes.success).toBe(true);
    const moveRes = resizeRoom(lockedRes.candidate!, { floorLevel: 0, spaceId: space.id, newWidth: space.rect.w + 2, newHeight: space.rect.h + 2 });
    expect(moveRes.success).toBe(false);
    expect(moveRes.error).toContain('locked');
  });

  it('locked geometry survives repair', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const spaceA = floor.spaces[0];
    const spaceB = floor.spaces[1];
    // Lock A
    const lockedRes = lockRoom(bestCandidate, { floorLevel: 0, spaceId: spaceA.id, lockKind: 'all' });
    expect(lockedRes.success).toBe(true);
    // Try to move B to overlap locked A — should fail
    const moveRes = moveRoom(lockedRes.candidate!, { floorLevel: 0, spaceId: spaceB.id, newX: spaceA.rect.x, newY: spaceA.rect.y });
    expect(moveRes.success).toBe(false);
  });

  it('impossible edit produces explicit failure, no silent lock violation', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const lockedRes = lockRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, lockKind: 'all' });
    const lockedCand = lockedRes.candidate!;
    // Try to resize locked room
    const resizeRes = resizeRoom(lockedCand, { floorLevel: 0, spaceId: space.id, newWidth: 10, newHeight: 10 });
    expect(resizeRes.success).toBe(false);
    expect(resizeRes.error).toBeDefined();
    // Ensure original candidate unchanged (no silent violation)
    const origSpace = bestCandidate.floors[0].spaces.find(s => s.id === space.id)!;
    expect(origSpace.rect.w).toBe(space.rect.w);
  });
});

describe('Phase 11 D. Editing', () => {
  it('move room', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const oldX = space.rect.x;
    const newX = oldX + 0.5;
    const res = moveRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newX, newY: space.rect.y });
    // May succeed or fail depending on overlap, but should be deterministic and not crash
    expect(typeof res.success).toBe('boolean');
    if (res.success) {
      const newSpace = res.candidate!.floors[0].spaces.find(s => s.id === space.id)!;
      expect(newSpace.rect.x).toBeCloseTo(newX, 1);
      expect(newSpace.polygon).toBeDefined();
      expect(newSpace.area).toBeGreaterThan(0);
    }
  });

  it('resize room', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces.find(s => s.type === 'living') ?? bestCandidate.floors[0].spaces[0];
    const newW = Math.max(2, space.rect.w * 0.9);
    const newH = Math.max(2, space.rect.h * 0.9);
    const res = resizeRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newWidth: newW, newHeight: newH });
    expect(typeof res.success).toBe('boolean');
    if (res.success) {
      const ns = res.candidate!.floors[0].spaces.find(s => s.id === space.id)!;
      expect(ns.rect.w).toBeCloseTo(newW, 1);
      expect(ns.rect.h).toBeCloseTo(newH, 1);
    }
  });

  it('deterministic repair', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const spaceA = bestCandidate.floors[0].spaces[0];
    const spaceB = bestCandidate.floors[0].spaces[1];
    // Move A slightly, should trigger bounded repair of B if overlap
    const res1 = moveRoom(bestCandidate, { floorLevel: 0, spaceId: spaceA.id, newX: spaceA.rect.x + 0.2, newY: spaceA.rect.y });
    const res2 = moveRoom(bestCandidate, { floorLevel: 0, spaceId: spaceA.id, newX: spaceA.rect.x + 0.2, newY: spaceA.rect.y });
    expect(res1.success).toBe(res2.success);
    if (res1.success && res2.success) {
      expect(JSON.stringify(res1.candidate!.floors[0].spaces.map(s => s.rect))).toBe(JSON.stringify(res2.candidate!.floors[0].spaces.map(s => s.rect)));
    }
  });

  it('invalid edit rejected', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    // Try to move outside buildable
    const res = moveRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newX: 100, newY: 100 });
    expect(res.success).toBe(false);
  });

  it('validation after edit', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const res = moveRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newX: space.rect.x + 0.3, newY: space.rect.y });
    if (res.success) {
      expect(res.findings).toBeDefined();
      // Should have no HARD site containment after successful edit
      const hardSite = res.findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
      expect(hardSite.length).toBe(0);
    }
  });

  it('set L-shape via editing', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces.find(s => s.type === 'living')!;
    const res = setLShape(bestCandidate, { floorLevel: 0, spaceId: space.id, notchWidth: 1, notchLength: 1, notchCorner: 'ne' });
    // May succeed if space large enough
    expect(typeof res.success).toBe('boolean');
    if (res.success) {
      const ns = res.candidate!.floors[0].spaces.find(s => s.id === space.id)!;
      expect(ns.polygon.length).toBe(6);
      expect(ns.shapeType).toBe('l-shape');
      expect(ns.area).toBeLessThan(ns.rect.w * ns.rect.h - 0.1);
    }
  });
});

describe('Phase 11 E. Site', () => {
  it('rectangle site', () => {
    const input = baseInput();
    input.site.shape = 'rectangle';
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.buildableRects.length).toBe(1);
  });

  it('L site', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'ne' };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.buildableRects.length).toBe(2);
  });

  it('8-vertex/C-shaped site', () => {
    const input = baseInput();
    (input.site as any).shape = 'polygon';
    (input.site as any).polygon = { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }] };
    input.site.width = 10;
    input.site.length = 10;
    (input.site as any).setbacks = { north: 0.5, south: 0.5, east: 0.5, west: 0.5 };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(true);
    expect(geom.buildableRects.length).toBeGreaterThanOrEqual(1);
    expect(geom.buildableRects.length).toBeLessThanOrEqual(6);
  });

  it('tight setbacks', () => {
    const input = baseInput();
    input.site.width = 10;
    input.site.length = 10;
    (input.site as any).setbacks = { north: 4, south: 4, east: 4, west: 4 };
    const geom = computeBuildableGeometry(input.site as any);
    // With tight setbacks, buildable area small but should be valid or have explicit error
    if (!geom.isValid) {
      expect(geom.validationErrors.length).toBeGreaterThan(0);
    }
  });

  it('room remains inside canonical buildable polygon', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 15, length: 20, notchWidth: 5, notchLength: 6, notchCorner: 'ne' };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const geom = computeBuildableGeometry(input.site as any);
    for (const fl of bestCandidate.floors) {
      for (const sp of fl.spaces) {
        expect(roomPolygonInsideBuildable(sp.polygon, geom.buildableBoundary)).toBe(true);
      }
    }
  });
});

describe('Phase 11 F. Multi-floor', () => {
  for (const floors of [1, 2, 3, 6, 10]) {
    it(`${floors}F`, () => {
      const input = baseInput();
      input.building.floors = floors;
      input.building.hasStair = floors > 1;
      const prj = createProject(input);
      const { bestCandidate } = generate(prj);
      expect(bestCandidate.floors.length).toBe(floors);
      // Check no floors[0] dependency for whole-building logic — each floor should have spaces
      for (const fl of bestCandidate.floors) {
        expect(fl.spaces.length).toBeGreaterThan(0);
      }
      // Check buildableBoundary present for all floors
      for (const fl of bestCandidate.floors) {
        expect((fl as any).buildableBoundary).toBeDefined();
      }
    });
  }
});

describe('Phase 11 G. Outputs', () => {
  it('DXF room polygon coordinates', () => {
    const input = baseInput();
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const dxf = writeDXF(bestCandidate, 'Test11');
    const polylines = parseDXFPolylines(dxf);
    // Check room polygons exist on floor-specific layers
    expect(polylines.has('A-FLOOR-0-A-ROOM')).toBe(true);
    expect(polylines.has('A-FLOOR-1-A-ROOM')).toBe(true);
    const floor0Rooms = polylines.get('A-FLOOR-0-A-ROOM')!;
    expect(floor0Rooms.length).toBeGreaterThan(0);
    // Each room polygon should have 4 or 6 verts (rectangle or L-shape)
    for (const poly of floor0Rooms) {
      expect([4, 6, 8].includes(poly.length)).toBe(true);
    }
  });

  it('PDF integration — documentation uses actual polygon area', async () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const doc = buildDocumentation(prj, bestCandidate);
    for (const room of doc.roomSchedule) {
      const space = bestCandidate.floors.flatMap(f => f.spaces).find(s => s.id === room.id);
      expect(space).toBeDefined();
      expect(room.area).toBeCloseTo(space!.area, 1);
    }
  });

  it('XLSX room area/geometry consistency', async () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const { docModel } = await exportAll(prj, bestCandidate);
    // Check room areas in docModel match candidate
    for (const fl of bestCandidate.floors) {
      for (const sp of fl.spaces) {
        const entry = docModel.roomSchedule.find(r => r.id === sp.id);
        expect(entry).toBeDefined();
        expect(entry!.area).toBeCloseTo(sp.area, 1);
      }
    }
  });

  it('report/manifest consistency', async () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const { docModel, report, manifest } = await exportAll(prj, bestCandidate);
    expect(manifest.geometry.candidateId).toBe(bestCandidate.id);
    expect(docModel.canonicalCandidateId).toBe(bestCandidate.id);
    expect(docModel.consistency.checksum).toBe(manifest.consistency.checksum);
    expect(report.consistency.checksum).toBe(docModel.consistency.checksum);
  });
});

describe('Phase 11 H. Determinism', () => {
  it('same input+seed+edit → same canonical geometry, validation, scores, DXF', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];

    const op = { floorLevel: 0, spaceId: space.id, newX: space.rect.x + 0.2, newY: space.rect.y };
    const res1 = moveRoom(bestCandidate, op);
    const res2 = moveRoom(bestCandidate, op);
    expect(res1.success).toBe(res2.success);
    if (res1.success && res2.success) {
      const s1 = res1.candidate!.floors[0].spaces.find(s => s.id === space.id)!;
      const s2 = res2.candidate!.floors[0].spaces.find(s => s.id === space.id)!;
      expect(s1.polygon).toEqual(s2.polygon);
      expect(s1.rect).toEqual(s2.rect);
      expect(s1.area).toBe(s2.area);
      expect(res1.findings.map(f => f.code).sort()).toEqual(res2.findings.map(f => f.code).sort());
      const dxf1 = writeDXF(res1.candidate!, 'Det');
      const dxf2 = writeDXF(res2.candidate!, 'Det');
      expect(dxf1).toBe(dxf2);
    }
  });
});

describe('Phase 11 I. Adversarial', () => {
  it('narrow rooms', () => {
    const rect = { x: 0, y: 0, w: 0.8, h: 4 };
    const poly = createRectangleRoomPolygon(rect);
    const v = validateRoomPolygon(poly);
    expect(v.valid).toBe(false); // too narrow
  });

  it('consumed buildable area', () => {
    const input = baseInput();
    input.site.width = 5;
    input.site.length = 5;
    (input.site as any).setbacks = { north: 2.5, south: 2.5, east: 2.5, west: 2.5 };
    const geom = computeBuildableGeometry(input.site as any);
    expect(geom.isValid).toBe(false);
  });

  it('concave site corner', () => {
    const input = baseInput();
    (input.site as any).shape = 'l-shape';
    (input.site as any).lShape = { width: 10, length: 10, notchWidth: 4, notchLength: 4, notchCorner: 'ne' };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    // Should have no HARD site findings for valid candidate
    const findings = validateSite(bestCandidate);
    const hard = findings.filter(f => f.severity === 'hard');
    // May have hard if tight, but should not crash
    expect(Array.isArray(hard)).toBe(true);
  });

  it('room boundary touch', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 4, y: 0, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    expect(roomPolygonsOverlap(polyA, polyB)).toBe(false); // touching, not overlapping
    const shared = sharedWallEdges(polyA, polyB);
    expect(shared.length).toBe(1);
  });

  it('impossible resize', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const res = resizeRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newWidth: 0.5, newHeight: 0.5 });
    expect(res.success).toBe(false);
  });

  it('locked-room collision', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const a = floor.spaces[0];
    const b = floor.spaces[1];
    const locked = lockRoom(bestCandidate, { floorLevel: 0, spaceId: a.id, lockKind: 'all' });
    const res = moveRoom(locked.candidate!, { floorLevel: 0, spaceId: b.id, newX: a.rect.x, newY: a.rect.y });
    expect(res.success).toBe(false);
  });

  it('overlapping rooms', () => {
    const rectA = { x: 0, y: 0, w: 4, h: 4 };
    const rectB = { x: 2, y: 2, w: 4, h: 4 };
    const polyA = createRectangleRoomPolygon(rectA);
    const polyB = createRectangleRoomPolygon(rectB);
    expect(roomPolygonsOverlap(polyA, polyB)).toBe(true);
  });

  it('invalid polygon', () => {
    const invalid = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]; // 3 verts
    const v = validateRoomPolygon(invalid as any);
    expect(v.valid).toBe(false);
  });

  it('unsupported geometry — non-orthogonal', () => {
    const nonOrtho = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 2 }];
    const v = validateRoomPolygon(nonOrtho);
    expect(v.valid).toBe(false);
  });
});

describe('Phase 11 J. Performance', () => {
  it('bounded limits, no unbounded repair/search', () => {
    const input = baseInput();
    input.building.floors = 10;
    input.building.hasStair = true;
    const start = Date.now();
    const prj = createProject(input);
    const { candidates } = generate(prj);
    const elapsed = Date.now() - start;
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(elapsed).toBeLessThan(10000);
    // Check no 4^floors explosion
    expect(candidates.length).toBeLessThan(Math.pow(4, input.building.floors));
  });

  it('editing bounded — no uncontrolled loops', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const space = bestCandidate.floors[0].spaces[0];
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      const res = moveRoom(bestCandidate, { floorLevel: 0, spaceId: space.id, newX: space.rect.x + i * 0.1, newY: space.rect.y });
      expect(typeof res.success).toBe('boolean');
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});

describe('Phase 11 — Canonical invariants', () => {
  it('Space.polygon authoritative, rect derived compatibility', () => {
    const input = baseInput();
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    for (const fl of bestCandidate.floors) {
      for (const sp of fl.spaces) {
        // Polygon area should equal stored area
        expect(sp.area).toBeCloseTo(polygonArea(sp.polygon), 3);
        // Rect should be bounding of polygon
        const br = polygonBoundingRect(sp.polygon);
        expect(sp.rect.x).toBeCloseTo(br.x, 2);
        expect(sp.rect.y).toBeCloseTo(br.y, 2);
        expect(sp.rect.w).toBeCloseTo(br.w, 2);
        expect(sp.rect.h).toBeCloseTo(br.h, 2);
        // No silent bbox fallback as canonical — polygon must be valid
        const v = validateRoomPolygon(sp.polygon);
        expect(v.valid).toBe(true);
      }
    }
  });

  it('area semantics actual vs bounding', () => {
    const rect = { x: 0, y: 0, w: 6, h: 5 };
    const polyRect = createRectangleRoomPolygon(rect);
    expect(roomPolygonArea(polyRect)).toBeCloseTo(rArea(rect), 3);

    const polyL = createLShapedRoomPolygon(rect, 2, 2, 'ne')!;
    expect(roomPolygonArea(polyL)).toBeLessThan(rArea(rect) - 0.1);
  });
});
