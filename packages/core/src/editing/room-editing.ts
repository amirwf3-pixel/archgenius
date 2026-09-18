/**
 * Phase 11.1 — Controlled Editing Implementation (CORE) — Hardened
 *
 * Expected flow:
 * edit operation → constraint-aware mutation → bounded repair of unlocked geometry (nudge + shrink) → validation (site + geometric + parametric constraints) → intelligence re-evaluation
 *
 * All operations are deterministic, bounded, seed-stable, no Math.random.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { Rect } from '../geometry/rect.js';
import { polygonArea, polygonBoundingRect } from '../geometry/polygon-ops.js';
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

const BOUNDED_REPAIR_MAX_ITER = 4;
const BOUNDED_REPAIR_STEP = 0.1;
const BOUNDED_SHRINK_STEP = 0.1;
const BOUNDED_SHRINK_MAX = 0.5;
const BOUNDED_SHRINK_ATTEMPTS = 5; // 0.1 *5 =0.5

function cloneCandidate(candidate: LayoutCandidate): LayoutCandidate {
  return JSON.parse(JSON.stringify(candidate)) as LayoutCandidate;
}

function findFloor(candidate: LayoutCandidate, level: number): Floor | undefined {
  return candidate.floors.find(f => f.level === level);
}

function findSpace(floor: Floor, spaceId: string): Space | undefined {
  return floor.spaces.find(s => s.id === spaceId);
}

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

function hasHardConstraintFinding(findings: any[]): boolean {
  return findings.some(f => f.severity === 'hard' && (f.code?.startsWith('CONSTRAINT_') || f.code?.startsWith('ROOM_CONSTRAINT_')));
}

function getHardConstraintFindings(findings: any[]): any[] {
  return findings.filter(f => f.severity === 'hard' && (f.code?.startsWith('CONSTRAINT_') || f.code?.startsWith('ROOM_CONSTRAINT_')));
}

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

  const newPoly = translateRoomPolygon(space.polygon, dx, dy);
  const v = validateRoomPolygon(newPoly);
  if (!v.valid) {
    return { success: false, candidate: null, findings: [], error: `Move results in invalid polygon: ${v.errors.join('; ')}`, attemptedOperation: { kind: 'move', ...op } };
  }

  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary as any;
  if (buildableBoundary) {
    if (!roomPolygonInsideBuildable(newPoly, buildableBoundary)) {
      return { success: false, candidate: null, findings: [], error: `Move would place room outside buildable boundary`, attemptedOperation: { kind: 'move', ...op } };
    }
  } else {
    const br = polygonBoundingRect(newPoly);
    if (br.x < floor.footprint.x - 1e-6 || br.y < floor.footprint.y - 1e-6 ||
        br.x + br.w > floor.footprint.x + floor.footprint.w + 1e-6 ||
        br.y + br.h > floor.footprint.y + floor.footprint.h + 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Move outside footprint`, attemptedOperation: { kind: 'move', ...op } };
    }
  }

  for (const other of floor.spaces) {
    if (other.id === space.id) continue;
    if (isLocked(other, 'position') || isLocked(other, 'geometry')) {
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        return { success: false, candidate: null, findings: [], error: `Move would overlap locked room ${other.id}`, attemptedOperation: { kind: 'move', ...op } };
      }
    }
  }

  space.polygon = newPoly;
  space.rect = roomPolygonToBoundingRect(newPoly);
  space.area = polygonArea(newPoly);

  const repairResult = boundedRepair(floor, space.id);
  if (!repairResult.success) {
    return { success: false, candidate: null, findings: [], error: repairResult.error, attemptedOperation: { kind: 'move', ...op } };
  }

  regenerateFloor(floor, cloned);

  const vr = validateLayout(cloned);
  const hardSite = vr.findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
  if (hardSite.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `Move results in HARD site containment: ${hardSite.map(h => h.code).join(', ')}`, attemptedOperation: { kind: 'move', ...op } };
  }
  const hardConstraints = getHardConstraintFindings(vr.findings);
  if (hardConstraints.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `Move violates HARD parametric constraints: ${hardConstraints.map(h => h.code).join(', ')}`, attemptedOperation: { kind: 'move', ...op } };
  }

  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);

  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'move', ...op } };
}

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

  if (space.constraints) {
    if (space.constraints.minWidth && Math.min(op.newWidth, op.newHeight) < space.constraints.minWidth - 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Resize violates minWidth ${space.constraints.minWidth}`, attemptedOperation: { kind: 'resize', ...op } };
    }
    if (space.constraints.minLength && Math.max(op.newWidth, op.newHeight) < space.constraints.minLength - 1e-6) {
      return { success: false, candidate: null, findings: [], error: `Resize violates minLength ${space.constraints.minLength}`, attemptedOperation: { kind: 'resize', ...op } };
    }
    if (space.constraints.maxArea && op.newWidth * op.newHeight > space.constraints.maxArea + 1e-6) {
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
    const inferred = inferLNotch(space.polygon, oldRect);
    if (inferred) {
      const newBounding: Rect = { x: newX, y: newY, w: op.newWidth, h: op.newHeight };
      const scaleW = op.newWidth / oldRect.w;
      const scaleH = op.newHeight / oldRect.h;
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

  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;
  if (buildableBoundary && !roomPolygonInsideBuildable(newPoly, buildableBoundary)) {
    return { success: false, candidate: null, findings: [], error: `Resize outside buildable`, attemptedOperation: { kind: 'resize', ...op } };
  }

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
  const hardConstraints = getHardConstraintFindings(vr.findings);
  if (hardConstraints.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `Resize violates HARD parametric constraints: ${hardConstraints.map(h => h.code).join(', ')}`, attemptedOperation: { kind: 'resize', ...op } };
  }

  cloned.findings = vr.findings;
  cloned.valid = vr.ok;
  cloned.metrics = computeMetrics(cloned);
  return { success: true, candidate: cloned, findings: vr.findings, attemptedOperation: { kind: 'resize', ...op } };
}

function inferLNotch(poly: any[], bounding: Rect): { notchWidth: number; notchLength: number; corner: 'ne' | 'nw' | 'se' | 'sw' } | null {
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
      let concave: any = null;
      for (let i = 0; i < poly.length; i++) {
        const prev = poly[(i - 1 + poly.length) % poly.length];
        const curr = poly[i];
        const next = poly[(i + 1) % poly.length];
        const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
        const cross = dx1 * dy2 - dy1 * dx2;
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
 * Bounded repair: try to resolve overlaps among unlocked rooms by minimal nudging and shrinking
 * Deterministic, bounded iterations, no explosion
 */
function boundedRepair(floor: Floor, editedSpaceId: string): { success: boolean; error?: string } {
  for (let iter = 0; iter < BOUNDED_REPAIR_MAX_ITER; iter++) {
    let hasOverlap = false;
    let repairedInIter = false;
    for (let i = 0; i < floor.spaces.length; i++) {
      for (let j = i + 1; j < floor.spaces.length; j++) {
        const a = floor.spaces[i];
        const b = floor.spaces[j];
        if (a.id === editedSpaceId && isLocked(a, 'position')) continue;
        if (roomPolygonsOverlap(a.polygon, b.polygon)) {
          if ((isLocked(a, 'position') || isLocked(a, 'geometry')) && (isLocked(b, 'position') || isLocked(b, 'geometry'))) {
            return { success: false, error: `Unresolvable overlap between locked rooms ${a.id} and ${b.id}` };
          }
          let toMove: Space | null = null;
          if (a.id === editedSpaceId) toMove = b;
          else if (b.id === editedSpaceId) toMove = a;
          else {
            if (!isLocked(a, 'position') && !isLocked(a, 'geometry')) toMove = a;
            else if (!isLocked(b, 'position') && !isLocked(b, 'geometry')) toMove = b;
          }
          if (!toMove) {
            return { success: false, error: `Overlap but no movable room ${a.id} vs ${b.id}` };
          }
          // Try nudge first, then shrink
          const moved = tryNudge(toMove, floor, editedSpaceId);
          if (moved) {
            repairedInIter = true;
            hasOverlap = true;
            continue;
          }
          const shrunk = tryShrink(toMove, floor, editedSpaceId);
          if (shrunk) {
            repairedInIter = true;
            hasOverlap = true;
            continue;
          }
          hasOverlap = true;
        }
      }
    }
    if (!hasOverlap) break;
    if (!repairedInIter && hasOverlap) {
      // No progress in this iteration, break to final check
      break;
    }
  }
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
    let overlaps = false;
    for (const other of floor.spaces) {
      if (other.id === space.id) continue;
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        if (other.id === editedId) { overlaps = true; break; }
        if (isLocked(other, 'position') || isLocked(other, 'geometry')) { overlaps = true; break; }
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

/**
 * Phase 11.1 — Bounded shrink repair
 * Only unlocked rooms may shrink, never below minArea/minWidth/minLength/hard constraints
 * Deterministic order, bounded attempts (step 0.1m, max 0.5m)
 */
function tryShrink(space: Space, floor: Floor, editedId: string): boolean {
  if (isLocked(space, 'size') || isLocked(space, 'geometry')) return false;
  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;

  // Determine current dimensions
  const curW = space.rect.w;
  const curH = space.rect.h;
  const curArea = space.area;

  // Hard constraints
  const minArea = space.constraints?.minArea ?? space.minArea ?? 1.0;
  const minWidth = space.constraints?.minWidth ?? space.minWidth ?? 0.9;
  const minLength = space.constraints?.minLength ?? space.minLength ?? 0.9;

  // Try shrinking width, height, both in deterministic order
  // Attempts: shrink W by 0.1..0.5, shrink H by 0.1..0.5, shrink both
  const attempts: Array<{ w: number; h: number }> = [];
  for (let i = 1; i <= BOUNDED_SHRINK_ATTEMPTS; i++) {
    const dw = BOUNDED_SHRINK_STEP * i;
    if (curW - dw >= minWidth - 1e-6 && curW - dw >= 0.9) {
      attempts.push({ w: curW - dw, h: curH });
    }
  }
  for (let i = 1; i <= BOUNDED_SHRINK_ATTEMPTS; i++) {
    const dh = BOUNDED_SHRINK_STEP * i;
    if (curH - dh >= minLength - 1e-6 && curH - dh >= 0.9) {
      attempts.push({ w: curW, h: curH - dh });
    }
  }
  for (let i = 1; i <= BOUNDED_SHRINK_ATTEMPTS; i++) {
    const d = BOUNDED_SHRINK_STEP * i;
    if (curW - d >= minWidth - 1e-6 && curH - d >= minLength - 1e-6 && curW - d >= 0.9 && curH - d >= 0.9) {
      attempts.push({ w: curW - d, h: curH - d });
    }
  }

  for (const att of attempts) {
    if (att.w * att.h < minArea - 1e-6) continue;
    if (att.w < 1.0 - 1e-6 || att.h < 1.0 - 1e-6) continue;

    let newPoly;
    if (space.shapeType === 'l-shape' && space.polygon.length === 6) {
      const inferred = inferLNotch(space.polygon, space.rect);
      if (inferred) {
        const newBounding: Rect = { x: space.rect.x, y: space.rect.y, w: att.w, h: att.h };
        const scaleW = att.w / curW;
        const scaleH = att.h / curH;
        const newNotchW = Math.min(inferred.notchWidth * scaleW, att.w * 0.5);
        const newNotchH = Math.min(inferred.notchLength * scaleH, att.h * 0.5);
        const lPoly = createLShapedRoomPolygon(newBounding, newNotchW, newNotchH, inferred.corner);
        if (lPoly) newPoly = lPoly;
        else newPoly = createRectangleRoomPolygon(newBounding);
      } else {
        const newBounding: Rect = { x: space.rect.x, y: space.rect.y, w: att.w, h: att.h };
        newPoly = createRectangleRoomPolygon(newBounding);
      }
    } else {
      const newBounding: Rect = { x: space.rect.x, y: space.rect.y, w: att.w, h: att.h };
      newPoly = createRectangleRoomPolygon(newBounding);
    }

    if (!newPoly) continue;
    const v = validateRoomPolygon(newPoly);
    if (!v.valid) continue;
    const newArea = polygonArea(newPoly);
    if (newArea < minArea - 1e-6) continue;
    if (space.constraints?.maxArea && newArea > space.constraints.maxArea + 1e-6) continue;
    if (buildableBoundary && !roomPolygonInsideBuildable(newPoly, buildableBoundary)) continue;

    let overlaps = false;
    for (const other of floor.spaces) {
      if (other.id === space.id) continue;
      if (roomPolygonsOverlap(newPoly, other.polygon)) {
        if (other.id === editedId) { overlaps = true; break; }
        if (isLocked(other, 'position') || isLocked(other, 'geometry')) { overlaps = true; break; }
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Success — apply shrink preserving polygon authoritative, rect derived, area derived
    space.polygon = newPoly;
    space.rect = roomPolygonToBoundingRect(newPoly);
    space.area = newArea;
    if (newPoly.length === 6) space.shapeType = 'l-shape';
    else if (newPoly.length === 4) space.shapeType = 'rectangle';
    else space.shapeType = 'orthogonal';
    return true;
  }
  return false;
}

function regenerateFloor(floor: Floor, candidate: LayoutCandidate) {
  floor.walls = generateWalls(floor.spaces, floor.level);
  floor.furniture = placeFurniture(floor.spaces);
  const anyCand = candidate as any;
  const accessSide = anyCand.siteInput?.accessSide ?? 'south';
  const { openings } = placeOpenings(floor, accessSide);
  floor.openings = openings;
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

  const newArea = polygonArea(lPoly);
  if (space.constraints?.minArea && newArea < space.constraints.minArea - 1e-6) {
    return { success: false, candidate: null, findings: [], error: `L-shape area ${newArea.toFixed(2)} < minArea ${space.constraints.minArea}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }
  if (space.constraints?.maxArea && newArea > space.constraints.maxArea + 1e-6) {
    return { success: false, candidate: null, findings: [], error: `L-shape area ${newArea.toFixed(2)} > maxArea ${space.constraints.maxArea}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

  const anyFloor = floor as any;
  const buildableBoundary = anyFloor.buildableBoundary;
  if (buildableBoundary && !roomPolygonInsideBuildable(lPoly, buildableBoundary)) {
    return { success: false, candidate: null, findings: [], error: `L-shape outside buildable`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

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
  const hardSite = vr.findings.filter(f => f.severity === 'hard' && f.code.startsWith('SITE_'));
  if (hardSite.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `L-shape results in HARD site containment`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }
  const hardConstraints = getHardConstraintFindings(vr.findings);
  if (hardConstraints.length > 0) {
    return { success: false, candidate: null, findings: vr.findings, error: `L-shape violates HARD parametric constraints: ${hardConstraints.map(h => h.code).join(', ')}`, attemptedOperation: { kind: 'set-l-shape', ...op } };
  }

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
