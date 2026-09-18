/**
 * Phase 12 — Constraint-Aware Architectural Placement: Hard-Constraint Graph
 *
 * Builds deterministic intermediate hard graph from canonical constraint model.
 * Only uses canonical model (DEFAULT_RESIDENTIAL_CONSTRAINTS), no duplicate rules.
 *
 * Hard kinds: MUST_BE_ADJACENT, MUST_BE_SEPARATED, DIRECT_ACCESS_REQUIRED (strength hard)
 * Soft kinds: PREFER_* (strength soft)
 *
 * Existence grouping preserved per Phase 11.2: grouping by toId for MUST_* and DIRECT_ACCESS.
 *
 * Bounds:
 * - MAX_CONSTRAINT_PLACEMENT_ATTEMPTS = 8
 * - MAX_LOCAL_REPAIR_ITERATIONS = 4
 * - MAX_CANDIDATE_POSITIONS = 12
 *
 * Priority: hard adjacency > direct access > separation > locked > circulation anchors, tie-break stable ID.
 * Cluster connected hard constraints via BFS on hard edges.
 */

import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from './constraints.js';
import type { Space } from '../model/space.js';
import type { ParametricAdjacencyConstraint } from './parametric-constraints.js';
import { createInstanceConstraintsFromTypes } from './parametric-constraints.js';

export const MAX_CONSTRAINT_PLACEMENT_ATTEMPTS = 8;
export const MAX_LOCAL_REPAIR_ITERATIONS = 4;
export const MAX_CANDIDATE_POSITIONS = 12;

export type HardConstraintKind = 'MUST_BE_ADJACENT' | 'MUST_BE_SEPARATED' | 'DIRECT_ACCESS_REQUIRED';
export type SoftConstraintKind = 'PREFER_ADJACENT' | 'PREFER_SEPARATED' | 'PRIVACY_REQUIRED';

export interface ConstraintGraphNode {
  type: string; // SpaceType
  hardDegree: number; // number of hard constraints incident
  priority: number; // placement priority
}

export interface ConstraintGraphEdge {
  fromType: string;
  toType: string;
  kind: HardConstraintKind | SoftConstraintKind;
  strength: 'hard' | 'soft';
  id: string;
}

export interface HardConstraintGraph {
  nodes: Map<string, ConstraintGraphNode>;
  hardEdges: ConstraintGraphEdge[];
  softEdges: ConstraintGraphEdge[];
  clusters: string[][]; // clusters of types connected by hard edges
  existenceGroups: Map<string, ConstraintGraphEdge[]>; // toType -> hard edges requiring existence
}

/**
 * Build type-level hard constraint graph from DEFAULT_RESIDENTIAL_CONSTRAINTS
 * Deterministic, no randomness.
 */
export function buildHardConstraintGraph(): HardConstraintGraph {
  const nodes = new Map<string, ConstraintGraphNode>();
  const hardEdges: ConstraintGraphEdge[] = [];
  const softEdges: ConstraintGraphEdge[] = [];
  const existenceGroups = new Map<string, ConstraintGraphEdge[]>();

  // Collect all types involved
  const allTypes = new Set<string>();
  for (const c of DEFAULT_RESIDENTIAL_CONSTRAINTS) {
    allTypes.add(c.fromType);
    allTypes.add(c.toType);
  }

  // Initialize nodes
  for (const t of allTypes) {
    nodes.set(t, { type: t, hardDegree: 0, priority: 0 });
  }

  // Classify edges
  for (const c of DEFAULT_RESIDENTIAL_CONSTRAINTS) {
    const edge: ConstraintGraphEdge = {
      fromType: c.fromType,
      toType: c.toType,
      kind: c.kind as any,
      strength: c.strength,
      id: c.id,
    };
    if (c.strength === 'hard' && (c.kind === 'MUST_BE_ADJACENT' || c.kind === 'MUST_BE_SEPARATED' || c.kind === 'DIRECT_ACCESS_REQUIRED')) {
      hardEdges.push(edge);
      // Existence grouping: for MUST_BE_ADJACENT and DIRECT_ACCESS_REQUIRED, group by toId (toType at type-level) per Phase 11.2
      if (c.kind === 'MUST_BE_ADJACENT' || c.kind === 'DIRECT_ACCESS_REQUIRED') {
        if (!existenceGroups.has(c.toType)) existenceGroups.set(c.toType, []);
        existenceGroups.get(c.toType)!.push(edge);
      }
      // MUST_BE_SEPARATED is pairwise, not existence grouped
    } else {
      softEdges.push(edge);
    }
  }

  // Compute hardDegree per type (count of hard edges incident as from or to)
  for (const t of allTypes) {
    let degree = 0;
    for (const e of hardEdges) {
      if (e.fromType === t || e.toType === t) degree++;
    }
    nodes.get(t)!.hardDegree = degree;
  }

  // Compute placement priority: hard adjacency > direct access > separation > locked > circulation anchors
  // We assign priority scores:
  // - MUST_BE_ADJACENT hard: 100
  // - DIRECT_ACCESS_REQUIRED hard: 90
  // - MUST_BE_SEPARATED hard: 80
  // - Circulation anchors (corridor, entrance, foyer, stair-hall): 70
  // - Locked (if any): 60 (handled elsewhere)
  // - PREFER_* soft: 10-30
  const circulationAnchors = new Set(['corridor', 'entrance', 'foyer', 'stair-hall', 'elevator-hall']);
  for (const t of allTypes) {
    let priority = 0;
    for (const e of hardEdges) {
      if (e.fromType === t || e.toType === t) {
        if (e.kind === 'MUST_BE_ADJACENT') priority = Math.max(priority, 100);
        else if (e.kind === 'DIRECT_ACCESS_REQUIRED') priority = Math.max(priority, 90);
        else if (e.kind === 'MUST_BE_SEPARATED') priority = Math.max(priority, 80);
      }
    }
    if (circulationAnchors.has(t)) priority = Math.max(priority, 70);
    // Soft contributes smaller
    for (const e of softEdges) {
      if (e.fromType === t || e.toType === t) {
        if (e.kind === 'PREFER_ADJACENT') priority = Math.max(priority, 30);
        else if (e.kind === 'PREFER_SEPARATED') priority = Math.max(priority, 20);
      }
    }
    nodes.get(t)!.priority = priority;
  }

  // Cluster connected hard constraints via BFS on hard edges (undirected)
  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const t of allTypes) {
    if (visited.has(t)) continue;
    // BFS from t following hard edges
    const queue: string[] = [t];
    const cluster: string[] = [];
    visited.add(t);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      cluster.push(cur);
      for (const e of hardEdges) {
        let neighbor: string | null = null;
        if (e.fromType === cur) neighbor = e.toType;
        else if (e.toType === cur) neighbor = e.fromType;
        if (neighbor && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (cluster.length > 1) {
      // Only keep clusters with more than one node connected by hard edges
      cluster.sort(); // deterministic
      clusters.push(cluster);
    }
  }
  // Sort clusters deterministically by first element
  clusters.sort((a, b) => a[0].localeCompare(b[0]));

  return { nodes, hardEdges, softEdges, clusters, existenceGroups };
}

/**
 * Build instance-level constraints from type graph and spaces, preserving Phase 11.2 existence grouping
 */
export function buildInstanceConstraints(spaces: Space[]): ParametricAdjacencyConstraint[] {
  return createInstanceConstraintsFromTypes(spaces, DEFAULT_RESIDENTIAL_CONSTRAINTS as any);
}

/**
 * Placement ordering: sort space types by hard priority, then hardDegree, then stable ID
 */
export function placementOrderForTypes(types: string[], graph: HardConstraintGraph): string[] {
  return [...types].sort((a, b) => {
    const na = graph.nodes.get(a);
    const nb = graph.nodes.get(b);
    const pa = na?.priority ?? 0;
    const pb = nb?.priority ?? 0;
    if (pa !== pb) return pb - pa; // higher priority first
    const da = na?.hardDegree ?? 0;
    const db = nb?.hardDegree ?? 0;
    if (da !== db) return db - da;
    return a.localeCompare(b); // deterministic tie-break
  });
}

/**
 * Feasibility classification
 */
export type FeasibilityStatus = 'satisfied' | 'violated_repairable' | 'genuinely_infeasible';

export interface FeasibilityResult {
  status: FeasibilityStatus;
  reasonCode: string;
  message: string;
  violatedConstraints: string[];
}

/**
 * Classify feasibility of placing a set of rooms with given available dimension vs required min
 */
export function classifyFeasibility(
  required: number,
  available: number,
  constraintIds: string[]
): FeasibilityResult {
  const eps = 1e-6;
  if (required <= available + eps) {
    return {
      status: 'satisfied',
      reasonCode: 'FEASIBLE',
      message: `Required ${required.toFixed(2)}m <= available ${available.toFixed(2)}m`,
      violatedConstraints: [],
    };
  }
  // If required exceeds available by small margin (<0.5m), consider repairable via resize
  if (required <= available + 0.5) {
    return {
      status: 'violated_repairable',
      reasonCode: 'HARD_CONSTRAINT_TIGHT_FIT',
      message: `Required ${required.toFixed(2)}m > available ${available.toFixed(2)}m by <0.5m — repairable via bounded resize, but will report HARD if not repaired`,
      violatedConstraints: constraintIds,
    };
  }
  // Genuinely infeasible
  return {
    status: 'genuinely_infeasible',
    reasonCode: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
    message: `Required ${required.toFixed(2)}m > available ${available.toFixed(2)}m — genuinely infeasible to satisfy all HARD constraints simultaneously`,
    violatedConstraints: constraintIds,
  };
}
