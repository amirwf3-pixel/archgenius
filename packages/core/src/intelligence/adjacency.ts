/**
 * Phase 8 - Functional / Adjacency Intelligence
 *
 * Evaluates MUST/PREFER/AVOID relationships with explicit kinds.
 * Deterministic, explainable, uses canonical geometry.
 */

import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { FunctionalRelationship, FunctionalEvaluation, FunctionalFinding } from './types.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from '../layout/constraints.js';
import { buildAdjMap, shortestPath, hasDirectAccess as hasDirectAccessGraph, areAdjacent, sameZone } from './graph.js';

const STRONG_RELATIONSHIPS: FunctionalRelationship[] = [
  // MUST
  { id: 'must-entr-foyer', fromType: 'entrance', toType: 'foyer', relationship: 'MUST', kind: 'direct_adjacency', weight: 10, reason: 'Entrance must open into foyer for transition', isHard: true },
  { id: 'must-foyer-living', fromType: 'foyer', toType: 'living', relationship: 'MUST', kind: 'direct_access', weight: 10, reason: 'Foyer must have direct access to living', isHard: true },
  { id: 'must-corridor-bedroom', fromType: 'corridor', toType: 'bedroom', relationship: 'MUST', kind: 'direct_access', weight: 9, reason: 'Bedrooms must open off corridor for privacy and access', isHard: true },
  { id: 'must-corridor-master', fromType: 'corridor', toType: 'master-bedroom', relationship: 'MUST', kind: 'direct_access', weight: 9, reason: 'Master bedroom must be accessible via corridor', isHard: true },
  { id: 'must-master-ensuite', fromType: 'master-bedroom', toType: 'master-bathroom', relationship: 'MUST', kind: 'direct_access', weight: 8, reason: 'Master ensuite requires direct access where ensuite exists', isHard: false },

  // PREFER strong functional
  { id: 'prefer-living-dining', fromType: 'living', toType: 'dining', relationship: 'PREFER', kind: 'direct_adjacency', weight: 8, reason: 'Living <-> Dining continuity preferred for open-plan', isHard: false },
  { id: 'prefer-kitchen-dining', fromType: 'kitchen', toType: 'dining', relationship: 'PREFER', kind: 'direct_adjacency', weight: 9, reason: 'Kitchen adjacent to dining for service efficiency', isHard: false },
  { id: 'prefer-kitchen-dining-access', fromType: 'kitchen', toType: 'dining', relationship: 'PREFER', kind: 'direct_access', weight: 8, reason: 'Kitchen <-> Dining direct access preferred', isHard: false },
  { id: 'prefer-kitchen-living', fromType: 'kitchen', toType: 'living', relationship: 'PREFER', kind: 'short_path', weight: 6, reason: 'Kitchen near living for family interaction', isHard: false },
  { id: 'prefer-master-ensuite-adj', fromType: 'master-bedroom', toType: 'master-bathroom', relationship: 'PREFER', kind: 'direct_adjacency', weight: 8, reason: 'Master ensuite adjacency preferred', isHard: false },
  { id: 'prefer-bedroom-private-circ', fromType: 'bedroom', toType: 'corridor', relationship: 'PREFER', kind: 'direct_access', weight: 7, reason: 'Bedroom should open to private circulation', isHard: false },
  { id: 'prefer-guestwc-entrance', fromType: 'guest-wc', toType: 'entrance', relationship: 'PREFER', kind: 'short_path', weight: 7, reason: 'Guest WC near entrance/public zone', isHard: false },
  { id: 'prefer-guestwc-foyer', fromType: 'guest-wc', toType: 'foyer', relationship: 'PREFER', kind: 'direct_adjacency', weight: 6, reason: 'Guest WC near foyer', isHard: false },
  { id: 'prefer-kitchen-storage', fromType: 'kitchen', toType: 'storage', relationship: 'PREFER', kind: 'direct_adjacency', weight: 6, reason: 'Storage/pantry near kitchen', isHard: false },

  // AVOID
  { id: 'avoid-bedroom-entrance', fromType: 'bedroom', toType: 'entrance', relationship: 'AVOID', kind: 'direct_access', weight: 10, reason: 'Bedroom should not directly open to entrance (privacy)', isHard: true },
  { id: 'avoid-master-entrance', fromType: 'master-bedroom', toType: 'entrance', relationship: 'AVOID', kind: 'direct_access', weight: 10, reason: 'Master bedroom must not directly open to entrance', isHard: true },
  { id: 'avoid-bedroom-foyer', fromType: 'bedroom', toType: 'foyer', relationship: 'AVOID', kind: 'direct_access', weight: 9, reason: 'Bedroom should not open directly to foyer', isHard: true },
  { id: 'avoid-bathroom-living', fromType: 'bathroom', toType: 'living', relationship: 'AVOID', kind: 'direct_access', weight: 8, reason: 'Bathroom should not directly open to living (exposure)', isHard: false },
  { id: 'avoid-bathroom-dining', fromType: 'bathroom', toType: 'dining', relationship: 'AVOID', kind: 'direct_access', weight: 7, reason: 'Bathroom should not open to dining', isHard: false },
  { id: 'avoid-wc-kitchen', fromType: 'guest-wc', toType: 'kitchen', relationship: 'AVOID', kind: 'direct_adjacency', weight: 6, reason: 'WC should be separated from kitchen', isHard: false },
  { id: 'avoid-kitchen-bedroom', fromType: 'kitchen', toType: 'bedroom', relationship: 'AVOID', kind: 'direct_access', weight: 6, reason: 'Kitchen should not directly open to bedroom', isHard: false },
  { id: 'avoid-service-public-cross', fromType: 'storage', toType: 'living', relationship: 'AVOID', kind: 'short_path', weight: 4, reason: 'Service should not cross public unnecessarily', isHard: false },
];

function hasDirectAccess(a: Space, b: Space, floor: Floor): boolean {
  return hasDirectAccessGraph(a.id, b.id, floor);
}

function shortestPathLength(fromId: string, toId: string, adj: Map<string, Set<string>>): number {
  return shortestPath(fromId, toId, adj);
}

export function evaluateFunctional(floor: Floor): FunctionalEvaluation {
  const adjMap = buildAdjMap(floor);
  const findings: FunctionalFinding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  let mustSatisfied = 0, mustTotal = 0;
  let preferSatisfied = 0, preferTotal = 0;
  let avoidSatisfied = 0, avoidTotal = 0;

  for (const rel of STRONG_RELATIONSHIPS) {
    const fromSpaces = floor.spaces.filter(s => s.type === rel.fromType);
    const toSpaces = floor.spaces.filter(s => s.type === rel.toType);
    if (fromSpaces.length === 0 || toSpaces.length === 0) continue;

    // For each from, check if any to satisfies relationship
    for (const from of fromSpaces) {
      let satisfied = false;
      let bestPair: { from: Space; to: Space } | null = null;

      for (const to of toSpaces) {
        let ok = false;
        switch (rel.kind) {
          case 'direct_adjacency':
            ok = areAdjacent(from, to);
            break;
          case 'direct_access':
            ok = hasDirectAccess(from, to, floor);
            break;
          case 'same_zone':
            ok = sameZone(from, to);
            break;
          case 'separated_zone':
            ok = !sameZone(from, to);
            break;
          case 'short_path':
            ok = shortestPathLength(from.id, to.id, adjMap) <= 2;
            break;
          case 'privacy_separation':
            // Must go through lower privacy circulation: check path includes corridor/foyer
            // Simplified: if not directly adjacent and path exists via circ
            const path = shortestPathLength(from.id, to.id, adjMap);
            ok = path > 1 && path !== Infinity;
            break;
        }

        if (rel.relationship === 'AVOID') {
          // For AVOID, satisfied means NOT having the relationship
          if (rel.kind === 'direct_access') {
            ok = !hasDirectAccess(from, to, floor);
          } else if (rel.kind === 'direct_adjacency') {
            ok = !areAdjacent(from, to);
          } else if (rel.kind === 'short_path') {
            ok = shortestPathLength(from.id, to.id, adjMap) > 2;
          }
        }

        if (ok) {
          satisfied = true;
          bestPair = { from, to };
          break;
        }
      }

      const finding: FunctionalFinding = {
        relationshipId: rel.id,
        fromId: from.id,
        toId: bestPair?.to.id ?? toSpaces[0]?.id ?? '',
        satisfied,
        strength: rel.relationship,
        kind: rel.kind,
        weight: rel.weight,
        message: `${rel.fromType} ${rel.relationship} ${rel.kind} ${rel.toType}: ${satisfied ? 'satisfied' : 'not satisfied'} - ${rel.reason}`,
        isHard: rel.isHard,
      };
      findings.push(finding);

      if (rel.relationship === 'MUST') {
        mustTotal++;
        if (satisfied) mustSatisfied++;
      } else if (rel.relationship === 'PREFER') {
        preferTotal++;
        if (satisfied) preferSatisfied++;
      } else {
        avoidTotal++;
        if (satisfied) avoidSatisfied++;
      }

      if (satisfied && rel.weight >= 7) {
        strengths.push(`+ ${rel.fromType} <-> ${rel.toType} (${rel.kind}) - ${rel.reason}`);
      } else if (!satisfied) {
        if (rel.relationship === 'MUST') {
          weaknesses.push(`- MUST ${rel.fromType} ${rel.kind} ${rel.toType} failed - ${rel.reason}`);
        } else if (rel.relationship === 'AVOID' && rel.weight >= 8) {
          weaknesses.push(`- AVOID violation: ${rel.fromType} ${rel.kind} ${rel.toType} - ${rel.reason}`);
        }
      }
    }
  }

  const total = mustTotal + preferTotal + avoidTotal;
  const satisfied = mustSatisfied + preferSatisfied + avoidSatisfied;
  const score = total > 0 ? satisfied / total : 1;

  // Deduplicate strengths/weaknesses
  const uniq = (arr: string[]) => Array.from(new Set(arr)).slice(0, 8);

  // Build evaluations with relationship attached for explainability
  const evaluations = findings.map(f => {
    const rel = STRONG_RELATIONSHIPS.find(r => r.id === f.relationshipId);
    return { ...f, relationship: rel! };
  });

  return {
    score,
    satisfiedCount: satisfied,
    totalCount: total,
    mustSatisfied,
    mustTotal,
    preferSatisfied,
    preferTotal,
    avoidSatisfied,
    avoidTotal,
    findings: findings.sort((a, b) => b.weight - a.weight),
    evaluations: evaluations.sort((a, b) => b.weight - a.weight) as any,
    satisfiedMust: mustSatisfied,
    satisfiedPrefer: preferSatisfied,
    strengths: uniq(strengths),
    weaknesses: uniq(weaknesses),
  };
}

export function getFunctionalRelationships(): FunctionalRelationship[] {
  return [...STRONG_RELATIONSHIPS];
}
