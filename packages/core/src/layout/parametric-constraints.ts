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
  | 'MUST_BE_ADJACENT'
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

  // Precompute adjacency for all pairs present in constraints
  const adjMap = new Map<string, boolean>(); // key `${fromId}|${toId}` -> adjacent
  for (const c of constraints) {
    const from = byId.get(c.fromId);
    const to = byId.get(c.toId);
    if (!from || !to) continue;
    const key = `${c.fromId}|${c.toId}`;
    if (!adjMap.has(key)) {
      const shared = sharedWallEdges(from.polygon, to.polygon).length > 0;
      const adjById = areAdjacentByWall(from, to);
      adjMap.set(key, shared || adjById);
    }
  }

  // Group constraints that require existence (MUST_ADJACENT, MUST_BE_ADJACENT, DIRECT_ACCESS_REQUIRED) by toId
  // For each toId, at least one fromId must be adjacent
  const existenceGroups = new Map<string, ParametricAdjacencyConstraint[]>(); // toId -> list
  const otherConstraints: ParametricAdjacencyConstraint[] = [];

  for (const c of constraints) {
    if (c.kind === 'MUST_ADJACENT' || c.kind === 'MUST_BE_ADJACENT' || c.kind === 'DIRECT_ACCESS_REQUIRED') {
      // Hard or soft, we treat as existence per toId
      if (!existenceGroups.has(c.toId)) existenceGroups.set(c.toId, []);
      existenceGroups.get(c.toId)!.push(c);
    } else {
      otherConstraints.push(c);
    }
  }

  // Validate existence groups
  for (const [toId, group] of existenceGroups) {
    const to = byId.get(toId);
    if (!to) continue;
    let satisfied = false;
    let representative: ParametricAdjacencyConstraint | null = null;
    for (const c of group) {
      const key = `${c.fromId}|${c.toId}`;
      const adjacent = adjMap.get(key) ?? false;
      if (adjacent) {
        satisfied = true;
        break;
      }
      if (!representative) representative = c;
    }
    if (!satisfied && representative) {
      const from = byId.get(representative.fromId);
      // Use declared strength
      findings.push({
        code: representative.kind === 'DIRECT_ACCESS_REQUIRED' ? 'CONSTRAINT_DIRECT_ACCESS' : 'CONSTRAINT_MUST_ADJACENT',
        severity: representative.strength,
        message: `Constraint ${representative.id}: ${from?.label ?? representative.fromId} must be adjacent to ${to.label} — ${representative.note ?? ''}`,
        entityIds: [representative.fromId, toId],
      });
    }
  }

  // Validate other constraints per pair (MUST_BE_SEPARATED, PREFER_*, PRIVACY)
  for (const c of otherConstraints) {
    const from = byId.get(c.fromId);
    const to = byId.get(c.toId);
    if (!from || !to) continue;
    const key = `${c.fromId}|${c.toId}`;
    const adjacent = adjMap.get(key) ?? false;

    switch (c.kind) {
      case 'MUST_BE_SEPARATED':
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_MUST_SEPARATED',
            severity: c.strength,
            message: `Constraint ${c.id}: ${from.label} must be separated from ${to.label} — ${c.note ?? ''}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PREFER_ADJACENT':
        if (!adjacent) {
          findings.push({
            code: 'CONSTRAINT_PREFER_ADJACENT',
            severity: c.strength,
            message: `Constraint ${c.id}: ${from.label} prefer adjacent to ${to.label}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PREFER_SEPARATED':
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_PREFER_SEPARATED',
            severity: c.strength,
            message: `Constraint ${c.id}: ${from.label} prefer separated from ${to.label}`,
            entityIds: [from.id, to.id],
          });
        }
        break;
      case 'PRIVACY_REQUIRED':
        if (adjacent) {
          findings.push({
            code: 'CONSTRAINT_PRIVACY',
            severity: c.strength,
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
