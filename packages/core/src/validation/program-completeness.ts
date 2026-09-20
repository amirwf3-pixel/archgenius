/**
 * Phase 15 M3 — program-completeness validation.
 *
 * The building-level program distribution (programming/program.ts) assigns an exact
 * set of required rooms to every floor. This check enforces the OTHER half of the
 * contract: a requested program room that placement failed to produce is NEVER
 * silently dropped — it surfaces as an explicit HARD finding, so the honest
 * feasibility gate (M2) demotes the candidate and the building-level result becomes
 * a deterministic INFEASIBLE instead of a plan pretending rooms exist.
 *
 * Circulation/core types (corridor, stair-hall, elevator-hall) are exempt: they are
 * structural circulation the system may legitimately split/merge per floor, and they
 * carry their own dedicated validators (circulation.ts, stair.ts).
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from './types.js';

export interface FloorProgramRequirement {
  level: number;
  /** Required count per space type assigned to this floor (generator-assigned program). */
  byType: Record<string, number>;
}

const CIRCULATION_EXEMPT = new Set(['corridor', 'stair-hall', 'elevator-hall']);

export function validateProgramCompleteness(candidate: LayoutCandidate): Finding[] {
  const reqs = (candidate as any).programRequirements as FloorProgramRequirement[] | undefined;
  if (!Array.isArray(reqs) || reqs.length === 0) return [];
  const out: Finding[] = [];
  for (const req of reqs) {
    const fl = candidate.floors.find(f => f.level === req.level);
    const placed = new Map<string, number>();
    if (fl) for (const s of fl.spaces) placed.set(s.type, (placed.get(s.type) ?? 0) + 1);
    for (const [type, count] of Object.entries(req.byType)) {
      if (CIRCULATION_EXEMPT.has(type)) continue;
      const got = placed.get(type) ?? 0;
      if (got < count) {
        out.push({
          code: 'ARCH_PROGRAM_UNPLACED',
          severity: 'hard',
          message: `Floor ${req.level}: requested program room '${type}' not placed (required x${count}, placed x${got}) — requested rooms are never silently dropped`,
          ruleId: 'PROGRAM_COMPLETENESS',
          reference: 'Phase15 M3 building-level program distribution',
          status: 'VERIFIED',
          entityIds: [],
        } as Finding);
      }
    }
  }
  return out;
}
