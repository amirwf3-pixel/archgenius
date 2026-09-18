/**
 * Phase 11 — Parametric Room Constraints & Locking Model
 *
 * Clean constraint model supporting:
 * - minArea, targetArea, maxArea
 * - minWidth, minLength
 * - preferredAspectRatio
 * - MUST_ADJACENT, PREFER_ADJACENT, MUST_BE_SEPARATED, PREFER_SEPARATED, DIRECT_ACCESS_REQUIRED, PRIVACY_REQUIRED
 * - zone, privacy
 *
 * Hard constraints separate from heuristic quality scoring.
 * Architectural heuristics remain heuristics, not legal.
 */

import type { Zone, PrivacyBand, SpaceType } from './space.js';

export type RoomConstraintKind =
  | 'MUST_ADJACENT'
  | 'PREFER_ADJACENT'
  | 'MUST_BE_SEPARATED'
  | 'PREFER_SEPARATED'
  | 'DIRECT_ACCESS_REQUIRED'
  | 'PRIVACY_REQUIRED';

export type ConstraintStrength = 'hard' | 'soft';

export interface RoomSizeConstraint {
  /** Minimum area m² — HARD */
  minArea?: number;
  /** Target area m² — soft preference */
  targetArea?: number;
  /** Maximum area m² — HARD upper bound */
  maxArea?: number;
  /** Minimum width m — HARD */
  minWidth?: number;
  /** Minimum length m — HARD */
  minLength?: number;
  /** Preferred aspect ratio (long/short) — soft */
  preferredAspectRatio?: number;
  /** Zone requirement — HARD if specified */
  zone?: Zone;
  /** Privacy band requirement — HARD if specified */
  privacy?: PrivacyBand;
}

export interface RoomAdjacencyConstraint {
  id: string;
  kind: RoomConstraintKind;
  strength: ConstraintStrength;
  fromId: string;
  toId: string;
  note?: string;
}

export interface ParametricRoomConstraints {
  /** Space ID this constraint set applies to */
  spaceId: string;
  /** Size constraints */
  size: RoomSizeConstraint;
  /** Adjacency constraints involving this space */
  adjacencies: RoomAdjacencyConstraint[];
}

/**
 * Room locking model — core-level.
 * Locked entities MUST NOT be modified by repair or editing.
 */
export interface RoomLock {
  spaceId: string;
  /** Position locked — cannot move */
  positionLocked: boolean;
  /** Size locked — cannot resize */
  sizeLocked: boolean;
  /** Geometry locked — cannot change polygon shape */
  geometryLocked: boolean;
  /** Adjacency locked — cannot change adjacency relationships */
  adjacencyLocked?: boolean;
}

export function createDefaultRoomLock(spaceId: string): RoomLock {
  return {
    spaceId,
    positionLocked: false,
    sizeLocked: false,
    geometryLocked: false,
    adjacencyLocked: false,
  };
}

export function isRoomLocked(lock: RoomLock | undefined, kind: 'position' | 'size' | 'geometry' | 'adjacency'): boolean {
  if (!lock) return false;
  switch (kind) {
    case 'position': return !!lock.positionLocked;
    case 'size': return !!lock.sizeLocked;
    case 'geometry': return !!lock.geometryLocked;
    case 'adjacency': return !!lock.adjacencyLocked;
    default: return false;
  }
}

/**
 * Validate room size constraints against actual polygon area and bounding rect
 */
export function validateRoomSizeConstraints(
  polygonArea: number,
  boundingRect: { w: number; h: number },
  constraints: RoomSizeConstraint
): { valid: boolean; errors: string[]; findings: Array<{ code: string; severity: 'hard' | 'soft'; message: string }> } {
  const errors: string[] = [];
  const findings: Array<{ code: string; severity: 'hard' | 'soft'; message: string }> = [];

  if (constraints.minArea !== undefined && polygonArea < constraints.minArea - 1e-6) {
    errors.push(`area ${polygonArea.toFixed(2)} < minArea ${constraints.minArea}`);
    findings.push({ code: 'ROOM_CONSTRAINT_MIN_AREA', severity: 'hard', message: `Area ${polygonArea.toFixed(2)} below min ${constraints.minArea}` });
  }
  if (constraints.maxArea !== undefined && polygonArea > constraints.maxArea + 1e-6) {
    errors.push(`area ${polygonArea.toFixed(2)} > maxArea ${constraints.maxArea}`);
    findings.push({ code: 'ROOM_CONSTRAINT_MAX_AREA', severity: 'hard', message: `Area ${polygonArea.toFixed(2)} above max ${constraints.maxArea}` });
  }
  if (constraints.minWidth !== undefined) {
    const minSide = Math.min(boundingRect.w, boundingRect.h);
    if (minSide < constraints.minWidth - 1e-6) {
      errors.push(`min side ${minSide.toFixed(2)} < minWidth ${constraints.minWidth}`);
      findings.push({ code: 'ROOM_CONSTRAINT_MIN_WIDTH', severity: 'hard', message: `Min side ${minSide.toFixed(2)} below minWidth ${constraints.minWidth}` });
    }
  }
  if (constraints.minLength !== undefined) {
    const maxSide = Math.max(boundingRect.w, boundingRect.h);
    if (maxSide < constraints.minLength - 1e-6) {
      errors.push(`max side ${maxSide.toFixed(2)} < minLength ${constraints.minLength}`);
      findings.push({ code: 'ROOM_CONSTRAINT_MIN_LENGTH', severity: 'hard', message: `Max side ${maxSide.toFixed(2)} below minLength ${constraints.minLength}` });
    }
  }
  if (constraints.preferredAspectRatio !== undefined) {
    const aspect = Math.max(boundingRect.w, boundingRect.h) / Math.max(Math.min(boundingRect.w, boundingRect.h), 1e-6);
    const diff = Math.abs(aspect - constraints.preferredAspectRatio);
    if (diff > 0.5) {
      findings.push({ code: 'ROOM_CONSTRAINT_ASPECT_RATIO', severity: 'soft', message: `Aspect ${aspect.toFixed(2)} differs from preferred ${constraints.preferredAspectRatio}` });
    }
  }

  return { valid: errors.length === 0, errors, findings };
}

/**
 * Create parametric constraints from SpaceSpec (backward compat)
 */
export function constraintsFromSpec(spec: { minArea: number; targetArea: number; maxArea?: number; minWidth?: number; minLength?: number; preferredAspectRatio?: number; zone?: Zone; privacy?: PrivacyBand }): RoomSizeConstraint {
  return {
    minArea: spec.minArea,
    targetArea: spec.targetArea,
    maxArea: spec.maxArea,
    minWidth: spec.minWidth,
    minLength: spec.minLength,
    preferredAspectRatio: spec.preferredAspectRatio,
    zone: spec.zone,
    privacy: spec.privacy,
  };
}
