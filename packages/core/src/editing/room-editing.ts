/**
 * Phase 11 — Controlled Editing Implementation (CORE)
 *
 * Expected flow:
 * edit operation → constraint-aware mutation → bounded repair of unlocked geometry → validation → intelligence re-evaluation
 *
 * All operations are deterministic, bounded, seed-stable, no Math.random.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { Rect } from '../geometry/rect.js';
import { rArea, rCorners, R } from '../geometry/rect.js';
import { polygonArea, polygonBoundingRect, pointInPolygon, rectInsidePolygon } from '../geometry/polygon-ops.js';
import {
  createRectangleRoomPolygon,
  createLShapedRoomPolygon,
  validateRoomPolygon,
  roomPolygonToBoundingRect,
  roomPolygonsOverlap,
  translateRoomPolygon,
  roomPolygonInsideBuildable,
} from '../geometry/room-polygon.js';
import { validateLayout } from '../validation/validator.js';
import { computeMetrics } from '../optimizer/metrics.js';
import { generateWalls } from '../generator/walls.js';
import { placeOpenings } from '../generator/openings.js';
import { placeFurniture } from '../generator/furniture.js';
import type { EditOperation, EditResult } from './types.js';
import type { Finding } from '../validation/types.js';

const BOUNDED_REPAIR_MAX_ITER = 4;
const BOUNDED_REPAIR_STEP = 0.1;

/**
 * Deep clone candidate for editing (deterministic, no random)
 */
function cloneCandidate(candidate: LayoutCandidate): LayoutCandidate {
  return JSON.parse(JSON.stringify(candidate)) as LayoutCandidate;
}

function findFloor(candidate: LayoutCandidate, level: number): Floor | undefined {
  return candidate.floors.find(f => f.level === level);
}

function findSpace(floor: Floor, spaceId: string): Space | undefined {
  return floor.spaces.find(s => s.id === spaceId);
}

/**
 * Check if space is locked for given kind
 */
function isLocked(space: Space, kind: 'position' | 'size' | 'geometry' | 'adjacency'): boolean {
  if (!space.locked) return false;
  switch (kind) {
    case 'position': return !!space.locked.position;
    case 'size': return !!space.locked.size;
    case 'geometry': return !!space.locked.geometry;
    case 'adjacency': return !!space.locked.adjacency;
    default: return false;
  }
}

/**
 * Apply move operation
 */
export function moveRoom(candidate: LayoutCandidate, op: { floorLevel: number; spaceId: string; newX: number; newY: number }): EditResult {
  const cloned = cloneCandidate(candidate);
  const floor = findFloor(cloned, op.floorLevel);
  if (!floor) {
    return { success: false, candidate: null, findings: [], error: `Floor ${op.floorLevel} not found`, attemptedOperation: { kind: 'move', ...op } };
  }
  const space = findSpace(floor, op.spaceId);
  if (!space) {
    return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} not found`, attemptedOperation: { kind: 'move', ...op } };
  }
  if (isLocked(space, 'position') || isLocked(space, 'geometry')) {
    return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} is locked for position/geometry`, attemptedOperation: { kind: 'move', ...op } };
  }

  const oldRect = space.rect;
  const dx = op.newX - oldRect.x;
  const dy = op.newY - oldRect.y;

  // Translate polygon (canonical)
  const newPoly = translateRoomPolygon(space.polygon, dx, dy);
  const v = validateRoomPolygon(newPoly);
  if (!v.valid) {
    return { success: false, candidate: null, findings: [], error: `Move results in invalid polygon: ${v.errors.join('; ')}`, attemptedOperation: { kind: 'move', ...op } };
  }

  // Check site containment — use buildableBoundary if available
  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary as any;
  if (buildableBoundary) {
    if (!roomPolygonInsideBuildable(newPoly, buildableBoundary)) {
      return { success: false, candidate: null, findings: [], error: `Move would place room outside buildable boundary`, attemptedOperation: { kind: 'move', ...op } };
    }
  } else {
    // Fallback to footprint bounding
    const br = polygonBoundingRect(newPoly);
    if (br.x < floor.footprint.x - 1e-6 || br.y < floor.footprint.y - 1e-6 ||
        br.x + br.w > floor.footprint.x + floor.footprint.w + 1e-6 ||
        br.y + br.h > floor.footprint.y + floor.footprint.h + 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Move outside footprint`, attemptedOperation: { kind: 'move', ...op } };
    }
  }

  // Check overlap with locked rooms
  for (const other of floor.spaces) {
    if (other.id === space.id) continue;
    if (isLocked(other, 'position') || isLocked(other, 'geometry')) {
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        return { success: false, candidate: null, findings: [], error: `Move would overlap locked room ${other.id}`, attemptedOperation: { kind: 'move', ...op } };
      }
    }
  }

  // Apply
  space.polygon = newPoly;
  space.rect = roomPolygonToBoundingRect(newPoly);
  space.area = polygonArea(newPoly);

  // Bounded repair of unlocked geometry — try to resolve overlaps with unlocked rooms by nudging them minimally
  const repairResult = boundedRepair(floor, space.id);
  if (!repairResult.success) {
    return { success: false, candidate: null, findings: [], error: repairResult.error, attemptedOperation: { kind: 'move', ...op } };
  }

  // Regenerate walls/openings/furniture for this floor
  regenerateFloor(floor, cloned);

  // Validate
  const vr = validateLayout(cloned);
  // Check for HARD site containment after edit
  const hardSite = vr.findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
  if (hardSite.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `Move results in HARD site containment: ${hardSite.map(h => h.code).join(', ')}`, attemptedOperation: { kind: 'move', ...op } };
  }

  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);

  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'move', ...op } };
}

/**
 * Resize operation — for rectangle rooms, change w/h; for L-shape, resize bounding rect then re-apply notch if possible
 */
export function resizeRoom(candidate: LayoutCandidate, op: { floorLevel: number; spaceId: string; newWidth: number; newHeight: number; anchor?: 'sw' | 'se' | 'nw' | 'ne' | 'center' }): EditResult {
  const cloned = cloneCandidate(candidate);
  const floor = findFloor(cloned, op.floorLevel);
  if (!floor) {
    return { success: false, candidate: null, findings: [], error: `Floor ${op.floorLevel} not found`, attemptedOperation: { kind: 'resize', ...op } };
  }
  const space = findSpace(floor, op.spaceId);
  if (!space) {
    return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} not found`, attemptedOperation: { kind: 'resize', ...op } };
  }
  if (isLocked(space, 'size') || isLocked(space, 'geometry')) {
    return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} locked for size/geometry`, attemptedOperation: { kind: 'resize', ...op } };
  }

  if (op.newWidth < 1.0 - 1e-6 || op.newHeight < 1.0 - 1e-6) {
    return { success: false, candidate: null, findings: [], error: `Resize too small ${op.newWidth}x${op.newHeight} < 1.0`, attemptedOperation: { kind: 'resize', ...op } };
  }

  // Check constraints if present
  if (space.constraints) {
    if (space.constraints.minWidth && Math.min(op.newWidth, op.newHeight) < space.constraints.minWidth - 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Resize violates minWidth ${space.constraints.minWidth}`, attemptedOperation: { kind: 'resize', ...op } };
    }
    if (space.constraints.minLength && Math.max(op.newWidth, op.newHeight) < space.constraints.minLength - 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Resize violates minLength ${space.constraints.minLength}`, attemptedOperation: { kind: 'resize', ...op } };
    }
    if (space.constraints.minArea && op.newWidth * op.newHeight < space.constraints.minArea - 1e-6) {
      // For L-shape actual area may be smaller than bounding, but we check bounding as approximation
      // Actual area check after polygon creation
    }
    if (space.constraints.maxArea && op.newWidth * op.newHeight > space.constraints.maxArea + 1e-6) {
      // Allow if L-shape will reduce area, but fail if rectangle
      if (space.shapeType === 'rectangle' || !space.shapeType) {
        return { success: false, candidate: null, findings: [], error: `Resize violates maxArea ${space.constraints.maxArea}`, attemptedOperation: { kind: 'resize', ...op } };
      }
    }
  }

  const anchor = op.anchor ?? 'sw';
  const oldRect = space.rect;
  let newX = oldRect.x, newY = oldRect.y;
  switch (anchor) {
    case 'sw': newX = oldRect.x; newY = oldRect.y; break;
    case 'se': newX = oldRect.x + oldRect.w - op.newWidth; newY = oldRect.y; break;
    case 'nw': newX = oldRect.x; newY = oldRect.y + oldRect.h - op.newHeight; break;
    case 'ne': newX = oldRect.x + oldRect.w - op.newWidth; newY = oldRect.y + oldRect.h - op.newHeight; break;
    case 'center': newX = oldRect.x + (oldRect.w - op.newWidth) / 2; newY = oldRect.y + (oldRect.h - op.newHeight) / 2; break;
  }

  let newPoly;
  if (space.shapeType === 'l-shape' && space.polygon.length === 6) {
    // For L-shape, try to preserve notch proportion
    const oldBound = oldRect;
    const notchW = oldBound.w - Math.max(...space.polygon.map(p => p.x)) + Math.min(...space.polygon.map(p => p.x)) + oldBound.w; // simplified: we need to infer notch
    // Instead, we will create new L-shape with same notch corner and proportional notch
    // For simplicity, use previous notch if we can infer, else create rectangle
    const inferred = inferLNotch(space.polygon, oldBound);
    if (inferred) {
      const newBounding: Rect = { x: newX, y: newY, w: op.newWidth, h: op.newHeight };
      // Scale notch proportionally but keep within bounds
      const scaleW = op.newWidth / oldBound.w;
      const scaleH = op.newHeight / oldBound.h;
      const newNotchW = Math.min(inferred.notchWidth * scaleW, op.newWidth * 0.5);
      const newNotchH = Math.min(inferred.notchLength * scaleH, op.newHeight * 0.5);
      const lPoly = createLShapedRoomPolygon(newBounding, newNotchW, newNotchH, inferred.corner);
      if (lPoly) newPoly = lPoly;
      else newPoly = createRectangleRoomPolygon(newBounding);
    } else {
      const newBounding: Rect = { x: newX, y: newY, w: op.newWidth, h: op.newHeight };
      newPoly = createRectangleRoomPolygon(newBounding);
    }
  } else {
    const newBounding: Rect = { x: newX, y: newY, w: op.newWidth, h: op.newHeight };
    newPoly = createRectangleRoomPolygon(newBounding);
  }

  if (!newPoly) {
    return { success: false, candidate: null, findings: [], error: `Resize failed to create polygon`, attemptedOperation: { kind: 'resize', ...op } };
  }

  const v = validateRoomPolygon(newPoly);
  if (!v.valid) {
    return { success: false, candidate: null, findings: [], error: `Resize invalid polygon: ${v.errors.join('; ')}`, attemptedOperation: { kind: 'resize', ...op } };
  }

  const newArea = polygonArea(newPoly);
  if (space.constraints?.minArea && newArea < space.constraints.minArea - 1e-6) {
    return { success: false, candidate: null, findings: [], error: `Resize area ${newArea.toFixed(2)} < minArea ${space.constraints.minArea}`, attemptedOperation: { kind: 'resize', ...op } };
  }
  if (space.constraints?.maxArea && newArea > space.constraints.maxArea + 1e-6) {
    return { success: false, candidate: null, findings: [], error: `Resize area ${newArea.toFixed(2)} > maxArea ${space.constraints.maxArea}`, attemptedOperation: { kind: 'resize', ...op } };
  }

  // Site containment
  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;
  if (buildableBoundary && !roomPolygonInsideBuildable(newPoly, buildableBoundary)) {
    return { success: false, candidate: null, findings: [], error: `Resize outside buildable`, attemptedOperation: { kind: 'resize', ...op } };
  }

  // Overlap with locked rooms
  for (const other of floor.spaces) {
    if (other.id === space.id) continue;
    if (isLocked(other, 'position') || isLocked(other, 'geometry')) {
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        return { success: false, candidate: null, findings: [], error: `Resize overlaps locked room ${other.id}`, attemptedOperation: { kind: 'resize', ...op } };
      }
    }
  }

  space.polygon = newPoly;
  space.rect = roomPolygonToBoundingRect(newPoly);
  space.area = newArea;
  if (newPoly.length === 6) space.shapeType = 'l-shape';
  else if (newPoly.length === 4) space.shapeType = 'rectangle';
  else space.shapeType = 'orthogonal';

  const repairResult = boundedRepair(floor, space.id);
  if (!repairResult.success) {
    return { success: false, candidate: null, findings: [], error: repairResult.error, attemptedOperation: { kind: 'resize', ...op } };
  }

  regenerateFloor(floor, cloned);
  const vr = validateLayout(cloned);
  const hardSite = vr.findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
  if (hardSite.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `Resize results in HARD site containment`, attemptedOperation: { kind: 'resize', ...op } };
  }

  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);
  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'resize', ...op } };
}

function inferLNotch(poly: any[], bounding: Rect): { notchWidth: number; notchLength: number; corner: 'ne' | 'nw' | 'se' | 'sw' } | null {
  // For L-shape 6 verts, bounding rect minus polygon area gives notch area, but we need dimensions
  // Simplified: check which corner of bounding rect is missing
  const br = bounding;
  const corners = [
    { x: br.x, y: br.y, c: 'sw' as const },
    { x: br.x + br.w, y: br.y, c: 'se' as const },
    { x: br.x + br.w, y: br.y + br.h, c: 'ne' as const },
    { x: br.x, y: br.y + br.h, c: 'nw' as const },
  ];
  for (const corner of corners) {
    let inside = false;
    for (const p of poly) {
      if (Math.abs(p.x - corner.x) < 1e-3 && Math.abs(p.y - corner.y) < 1e-3) { inside = true; break; }
    }
    if (!inside) {
      // Found missing corner
      // Estimate notch dimensions from polygon extents
      // For ne missing, notch is top-right
      // Find concave vertex
      let concave: any = null;
      for (let i = 0; i < poly.length; i++) {
        const prev = poly[(i - 1 + poly.length) % poly.length];
        const curr = poly[i];
        const next = poly[(i + 1) % poly.length];
        // Simple concave detection: if interior angle > 180, cross product sign differs
        // For orthogonal, we can detect by checking if both prev and next are on same side
        // We'll approximate: find vertex where both adjacent edges go inward
        const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
        const cross = dx1 * dy2 - dy1 * dx2;
        // For CCW, concave has negative cross
        if (cross < -1e-6) { concave = curr; break; }
      }
      if (!concave) return null;
      if (corner.c === 'ne') {
        return { notchWidth: br.x + br.w - concave.x, notchLength: br.y + br.h - concave.y, corner: 'ne' };
      } else if (corner.c === 'nw') {
        return { notchWidth: concave.x - br.x, notchLength: br.y + br.h - concave.y, corner: 'nw' };
      } else if (corner.c === 'se') {
        return { notchWidth: br.x + br.w - concave.x, notchLength: concave.y - br.y, corner: 'se' };
      } else {
        return { notchWidth: concave.x - br.x, notchLength: concave.y - br.y, corner: 'sw' };
      }
    }
  }
  return null;
}

/**
 * Bounded repair: try to resolve overlaps among unlocked rooms by minimal nudging
 * Deterministic, bounded iterations, no explosion
 */
function boundedRepair(floor: Floor, editedSpaceId: string): { success: boolean; error?: string } {
  for (let iter = 0; iter < BOUNDED_REPAIR_MAX_ITER; iter++) {
    let hasOverlap = false;
    for (let i = 0; i < floor.spaces.length; i++) {
      for (let j = i + 1; j < floor.spaces.length; j++) {
        const a = floor.spaces[i];
        const b = floor.spaces[j];
        if (a.id === editedSpaceId && isLocked(a, 'position')) continue; // edited is already checked
        if (roomPolygonsOverlap(a.polygon, b.polygon)) {
          // If both locked, fail
          if ((isLocked(a, 'position') || isLocked(a, 'geometry')) && (isLocked(b, 'position') || isLocked(b, 'geometry'))) {
            return { success: false, error: `Unresolvable overlap between locked rooms ${a.id} and ${b.id}` };
          }
          // Try to move the unlocked one that is not the edited space, or the one with lower priority
          let toMove: Space | null = null;
          if (a.id === editedSpaceId) toMove = b;
          else if (b.id === editedSpaceId) toMove = a;
          else {
            // Move the one that is not locked
            if (!isLocked(a, 'position') && !isLocked(a, 'geometry')) toMove = a;
            else if (!isLocked(b, 'position') && !isLocked(b, 'geometry')) toMove = b;
          }
          if (!toMove) {
            return { success: false, error: `Overlap but no movable room ${a.id} vs ${b.id}` };
          }
          // Simple nudge: try 4 directions by step
          const moved = tryNudge(toMove, floor, editedSpaceId);
          if (!moved) {
            // If cannot nudge, fail repair
            hasOverlap = true;
          } else {
            hasOverlap = true;
          }
        }
      }
    }
    if (!hasOverlap) break;
  }
  // Final check: any remaining overlap among unlocked rooms is allowed to be flagged as HARD by validation, but we try to minimize
  // For Phase 11, we allow repair to leave some overlaps if they involve edited room? Actually we should fail if overlap remains with locked rooms, else let validation catch
  for (let i = 0; i < floor.spaces.length; i++) {
    for (let j = i + 1; j < floor.spaces.length; j++) {
      const a = floor.spaces[i];
      const b = floor.spaces[j];
      if (roomPolygonsOverlap(a.polygon, b.polygon)) {
        if ((isLocked(a, 'position') || isLocked(a, 'geometry')) || (isLocked(b, 'position') || isLocked(b, 'geometry'))) {
          return { success: false, error: `Repair failed, overlap remains with locked room ${a.id} vs ${b.id}` };
        }
      }
    }
  }
  return { success: true };
}

function tryNudge(space: Space, floor: Floor, editedId: string): boolean {
  const steps = [
    { dx: BOUNDED_REPAIR_STEP, dy: 0 },
    { dx: -BOUNDED_REPAIR_STEP, dy: 0 },
    { dx: 0, dy: BOUNDED_REPAIR_STEP },
    { dx: 0, dy: -BOUNDED_REPAIR_STEP },
  ];
  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;
  for (const step of steps) {
    const newPoly = translateRoomPolygon(space.polygon, step.dx, step.dy);
    if (!validateRoomPolygon(newPoly).valid) continue;
    if (buildableBoundary && !roomPolygonInsideBuildable(newPoly, buildableBoundary)) continue;
    // Check overlap with all other spaces except itself
    let overlaps = false;
    for (const other of floor.spaces) {
      if (other.id === space.id) continue;
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        // If other is edited space, we already know they overlap, but nudging might reduce?
        // Allow overlap with edited space to be resolved iteratively
        if (other.id === editedId) { overlaps = true; break; }
        // If other is locked, cannot overlap
        if (isLocked(other, 'position') || isLocked(other, 'geometry')) { overlaps = true; break; }
        // For unlocked, we allow temporary overlap, will be resolved in next iter
        // But for this simple check, we consider any overlap as bad to avoid cascading
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      space.polygon = newPoly;
      space.rect = roomPolygonToBoundingRect(newPoly);
      space.area = polygonArea(newPoly);
      return true;
    }
  }
  return false;
}

function regenerateFloor(floor: Floor, candidate: LayoutCandidate) {
  // Regenerate walls from canonical polygon
  floor.walls = generateWalls(floor.spaces, floor.level);
  // Furniture
  floor.furniture = placeFurniture(floor.spaces);
  // Openings — need accessSide from candidate metadata? Use south as default, but we have siteInput stored
  const anyCand = candidate as any;
  const accessSide = anyCand.siteInput?.accessSide ?? 'south';
  const { openings } = placeOpenings(floor, accessSide);
  floor.openings = openings;
  // Re-link wallIds etc — similar to generator
  for (const w of floor.walls) {
    for (const id of w.spaceIds) {
      if (!id) continue;
      const sp = floor.spaces.find(s => s.id === id);
      if (!sp) continue;
      if (!sp.wallIds.includes(w.id)) sp.wallIds.push(w.id);
      if (w.kind === 'exterior') sp.hasExteriorWall = true;
      for (const oid of w.spaceIds) {
        if (oid && oid !== id && !sp.adjacentSpaceIds.includes(oid)) sp.adjacentSpaceIds.push(oid);
      }
    }
  }
  for (const o of floor.openings) {
    const w = floor.walls.find(w => w.id === o.wallId);
    if (!w) continue;
    for (const id of w.spaceIds) {
      if (!id) continue;
      const sp = floor.spaces.find(s => s.id === id);
      if (sp && !sp.openingIds.includes(o.id)) sp.openingIds.push(o.id);
    }
  }
}

export function lockRoom(candidate: LayoutCandidate, op: { floorLevel: number; spaceId: string; lockKind: 'position' | 'size' | 'geometry' | 'adjacency' | 'all' }): EditResult {
  const cloned = cloneCandidate(candidate);
  const floor = findFloor(cloned, op.floorLevel);
  if (!floor) return { success: false, candidate: null, findings: [], error: `Floor ${op.floorLevel} not found`, attemptedOperation: { kind: 'lock', ...op } };
  const space = findSpace(floor, op.spaceId);
  if (!space) return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} not found`, attemptedOperation: { kind: 'lock', ...op } };
  if (!space.locked) space.locked = {};
  if (op.lockKind === 'all') {
    space.locked.position = true;
    space.locked.size = true;
    space.locked.geometry = true;
    space.locked.adjacency = true;
  } else {
    (space.locked as any)[op.lockKind] = true;
  }
  const vr = validateLayout(cloned);
  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);
  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'lock', ...op } };
}

export function unlockRoom(candidate: LayoutCandidate, op: { floorLevel: number; spaceId: string; lockKind: 'position' | 'size' | 'geometry' | 'adjacency' | 'all' }): EditResult {
  const cloned = cloneCandidate(candidate);
  const floor = findFloor(cloned, op.floorLevel);
  if (!floor) return { success: false, candidate: null, findings: [], error: `Floor ${op.floorLevel} not found`, attemptedOperation: { kind: 'unlock', ...op } };
  const space = findSpace(floor, op.spaceId);
  if (!space) return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} not found`, attemptedOperation: { kind: 'unlock', ...op } };
  if (!space.locked) space.locked = {};
  if (op.lockKind === 'all') {
    space.locked.position = false;
    space.locked.size = false;
    space.locked.geometry = false;
    space.locked.adjacency = false;
  } else {
    (space.locked as any)[op.lockKind] = false;
  }
  const vr = validateLayout(cloned);
  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);
  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'unlock', ...op } };
}

export function setLShape(candidate: LayoutCandidate, op: { floorLevel: number; spaceId: string; notchWidth: number; notchLength: number; notchCorner: 'ne' | 'nw' | 'se' | 'sw' }): EditResult {
  const cloned = cloneCandidate(candidate);
  const floor = findFloor(cloned, op.floorLevel);
  if (!floor) return { success: false, candidate: null, findings: [], error: `Floor ${op.floorLevel} not found`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  const space = findSpace(floor, op.spaceId);
  if (!space) return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} not found`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  if (isLocked(space, 'geometry') || isLocked(space, 'size')) {
    return { success: false, candidate: null, findings: [], error: `Space ${op.spaceId} locked for geometry/size`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  const bounding = space.rect;
  const lPoly = createLShapedRoomPolygon(bounding, op.notchWidth, op.notchLength, op.notchCorner);
  if (!lPoly) {
    return { success: false, candidate: null, findings: [], error: `Failed to create L-shape polygon with notch ${op.notchWidth}x${op.notchLength} corner ${op.notchCorner}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  // Check constraints
  const newArea = polygonArea(lPoly);
  if (space.constraints?.minArea && newArea < space.constraints.minArea - 1e-6) {
    return { success: false, candidate: null, findings: [], error: `L-shape area ${newArea.toFixed(2)} < minArea ${space.constraints.minArea}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }
  if (space.constraints?.maxArea && newArea > space.constraints.maxArea + 1e-6) {
    return { success: false, candidate: null, findings: [], error: `L-shape area ${newArea.toFixed(2)} > maxArea ${space.constraints.maxArea}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  // Site containment
  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;
  if (buildableBoundary && !roomPolygonInsideBuildable(lPoly, buildableBoundary)) {
    return { success: false, candidate: null, findings: [], error: `L-shape outside buildable`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  // Overlap with locked rooms
  for (const other of floor.spaces) {
    if (other.id === space.id) continue;
    if (isLocked(other, 'position') || isLocked(other, 'geometry')) {
      if (roomPolygonsOverlap(lPoly, other.polygon)) {
        return { success: false, candidate: null, findings: [], error: `L-shape overlaps locked room ${other.id}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
      }
    }
  }

  space.polygon = lPoly;
  space.rect = roomPolygonToBoundingRect(lPoly);
  space.area = newArea;
  space.shapeType = 'l-shape';

  const repairResult = boundedRepair(floor, space.id);
  if (!repairResult.success) {
    return { success: false, candidate: null, findings: [], error: repairResult.error, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  regenerateFloor(floor, cloned);
  const vr = validateLayout(cloned);
  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);
  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'set-l-shape', ...op } };
}

export function applyEdit(candidate: LayoutCandidate, op: EditOperation): EditResult {
  switch (op.kind) {
    case 'move': return moveRoom(candidate, op);
    case 'resize': return resizeRoom(candidate, op);
    case 'lock': return lockRoom(candidate, op);
    case 'unlock': return unlockRoom(candidate, op);
    case 'set-l-shape': return setLShape(candidate, op);
    default: return { success: false, candidate: null, findings: [], error: `Unknown edit kind ${(op as any).kind}`, attemptedOperation: op };
  }
}
