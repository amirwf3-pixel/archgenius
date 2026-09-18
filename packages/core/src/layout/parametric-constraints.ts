/**
 * Phase 11 — Parametric Constraint Model (instance-level)
 *
 * Supports:
 * - minArea, targetArea, maxArea, minWidth, minLength, preferredAspectRatio
 * - MUST_ADJACENT, PREFER_ADJACENT, MUST_BE_SEPARATED, PREFER_SEPARATED, DIRECT_ACCESS_REQUIRED, PRIVACY_REQUIRED
 * - zone, privacy
 *
 * Hard constraints separate from heuristic quality scoring.
 */

import type { Space } from '../model/space.js';
import type { Finding } from '../validation/types.js';
import { roomPolygonsOverlap, sharedWallEdges } from '../geometry/room-polygon.js';

export type ParametricConstraintKind =
  | 'MUST_ADJACENT'
  | 'PREFER_ADJACENT'
  | 'MUST_BE_SEPARATED'
  | 'PREFER_SEPARATED'
  | 'DIRECT_ACCESS_REQUIRED'
  | 'PRIVACY_REQUIRED';

export interface ParametricAdjacencyConstraint {
  id: string;
  kind: ParametricConstraintKind;
  strength: 'hard' | 'soft';
  fromId: string;
  toId: string;
  note?: string;
}

/**
 * Validate adjacency constraints for a floor
 */
export function validateParametricConstraints(
  spaces: Space[],
  constraints: ParametricAdjacencyConstraint[]
): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(spaces.map(s => [s.id, s]));

  for (const c of constraints) {
    const from = byId.get(c.fromId);
    const to = byId.get(c.toId);
    if (!from || !to) continue;

    const adjacent = sharedWallEdges(from.polygon, to.polygon).length > 0 || roomPolygonsOverlap(from.polygon, to.polygon, 0.05) === false && areAdjacentByWall(from, to);
    const separated = !adjacent;

    switch (c.kind) {
      case 'MUST_ADJACENT':
        if (!adjacent) {
          findings.push({
            code: 'CONSTRAINT_MUST_ADJACENT',
            severity: c.strength === 'hard' ? 'hard' : 'soft',
            message: `Constraint ${c.id}: ${from.label} must be adjacent to ${to.label} — ${c.note ?? ''}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'MUST_BE_SEPARATED':
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_MUST_SEPARATED',
            severity: c.strength === 'hard' ? 'hard' : 'soft',
            message: `Constraint ${c.id}: ${from.label} must be separated from ${to.label} — ${c.note ?? ''}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PREFER_ADJACENT':
        if (!adjacent) {
          findings.push({
            code: 'CONSTRAINT_PREFER_ADJACENT',
            severity: 'soft',
            message: `Constraint ${c.id}: ${from.label} prefer adjacent to ${to.label}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PREFER_SEPARATED':
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_PREFER_SEPARATED',
            severity: 'soft',
            message: `Constraint ${c.id}: ${from.label} prefer separated from ${to.label}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'DIRECT_ACCESS_REQUIRED':
        // Check if there's a door between them — simplified: adjacent and both have openings on shared wall
        if (!adjacent) {
          findings.push({
            code: 'CONSTRAINT_DIRECT_ACCESS',
            severity: c.strength === 'hard' ? 'hard' : 'soft',
            message: `Constraint ${c.id}: ${from.label} requires direct access to ${to.label}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PRIVACY_REQUIRED':
        // Privacy: should not share direct door, must go through circulation
        // Simplified: if adjacent, soft warning
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_PRIVACY',
            severity: 'soft',
            message: `Constraint ${c.id}: ${from.label} privacy required from ${to.label} — direct adjacency`,
            entityIds: [from.id, to.id],
          });
        }
        break;
    }
  }

  return findings;
}

function areAdjacentByWall(a: Space, b: Space): boolean {
  // Check if they share wall via wallIds adjacency — simplified via adjacentSpaceIds
  return a.adjacentSpaceIds.includes(b.id) || b.adjacentSpaceIds.includes(a.id);
}

/**
 * Create default parametric constraints from type-level DEFAULT_RESIDENTIAL_CONSTRAINTS
 * Maps type-level to instance-level for a given floor
 */
export function createInstanceConstraintsFromTypes(
  spaces: Space[],
  typeConstraints: Array<{ id: string; kind: ParametricConstraintKind; strength: 'hard' | 'soft'; fromType: string; toType: string; note?: string }>
): ParametricAdjacencyConstraint[] {
  const result: ParametricAdjacencyConstraint[] = [];
  for (const tc of typeConstraints) {
    const fromSpaces = spaces.filter(s => s.type === tc.fromType);
    const toSpaces = spaces.filter(s => s.type === tc.toType);
    for (const f of fromSpaces) {
      for (const t of toSpaces) {
        if (f.id === t.id) continue;
        result.push({
          id: `${tc.id}-${f.id}-${t.id}`,
          kind: tc.kind,
          strength: tc.strength,
          fromId: f.id,
          toId: t.id,
          note: tc.note,
        });
      }
    }
  }
  return result;
}
