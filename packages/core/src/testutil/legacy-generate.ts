/**
 * Phase 15 M2 — TEST-ONLY fixture helper (not part of the public API).
 *
 * Replicates the PRE-M2 pipeline candidate contract (Phase 13.1/13.2 gate:
 * geometry-validity only) so that tests which merely need A GENERATED PLAN to
 * inspect — stair geometry, DXF writer structure, regulation findings,
 * multi-floor plumbing — keep exercising the exact same candidate objects
 * they asserted on before the honest HARD-feasibility gate.
 *
 * Product semantics live in pipeline.generate(); anything testing THE GATE
 * ITSELF must call pipeline.generate() — never this helper.
 */
import { generateLayouts, ALL_STRATEGIES } from '../generator/generator.js';
import { compareCandidates } from '../layout/ranking.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Project } from '../model/project.js';
import type { CandidateStrategy } from '../model/layout.js';

export interface LegacyGenerateResult {
  project: Project;
  candidates: LayoutCandidate[];
  bestCandidate: LayoutCandidate | null;
  infeasible: {
    code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION';
    severity: 'hard';
    explanation: string;
    attempts: Array<{ strategy: string; candidateId: string; reason: string }>;
    attemptedCandidates: number;
    diagnosticCandidates: LayoutCandidate[];
  } | null;
}

/** Same minimum-geometry contract as pipeline.isValidRoomGeometry (Phase 13.2). */
export function satisfiesMinGeometryContract(c: LayoutCandidate): { valid: boolean; reason?: string } {
  for (const fl of c.floors) {
    for (const s of fl.spaces) {
      const r = s.rect;
      if (!r) return { valid: false, reason: `missing rect ${s.type}` };
      if (!(r.w > 0) || !(r.h > 0)) return { valid: false, reason: `non-positive dimension ${s.type} w=${r.w} h=${r.h}` };
      if (!(s.area > 0)) return { valid: false, reason: `non-positive area ${s.type}` };
      const minW = s.minWidth ?? s.constraints?.minWidth ?? 0.9;
      const minL = s.minLength ?? s.constraints?.minLength ?? s.minWidth ?? 0.9;
      const minA = s.minArea ?? s.constraints?.minArea ?? 0;
      if (r.w + 1e-6 < minW - 0.05) return { valid: false, reason: `below minWidth ${s.type} w=${r.w} < ${minW}` };
      if (r.h + 1e-6 < minL - 0.05) return { valid: false, reason: `below minLength ${s.type} h=${r.h} < ${minL}` };
      if (minA > 1e-6 && s.area + 1e-6 < minA - 0.1) return { valid: false, reason: `below minArea ${s.type} area=${s.area} < ${minA}` };
      if (s.polygon && s.polygon.length < 3) return { valid: false, reason: `invalid polygon ${s.type}` };
    }
  }
  return { valid: true };
}

/**
 * Pre-M2 generate(): geometry filter + ranking; no HARD-rule gate.
 * Keeps mutation semantics of the old pipeline (DIM finding pushed onto
 * rejected candidates; project.candidates/selectedCandidateId updated).
 */
export function legacyGenerate(project: Project, opts: { allStrategies?: boolean; strategies?: CandidateStrategy[] } = {}): LegacyGenerateResult {
  const strategies = opts.strategies ?? ([...ALL_STRATEGIES] as CandidateStrategy[]);
  const all = generateLayouts(project.input, strategies);
  const valid: LayoutCandidate[] = [];
  const invalid: Array<{ cand: LayoutCandidate; reason: string }> = [];
  for (const cand of all) {
    const check = satisfiesMinGeometryContract(cand);
    if (check.valid) { valid.push(cand); continue; }
    cand.findings.push({
      code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
      severity: 'hard',
      message: `Phase13.2 infeasible dimension: ${check.reason} — candidate excluded from usable candidates (diagnostic only); when no valid candidate exists the result is INFEASIBLE with bestCandidate=null`,
      ruleId: 'GEOM_VALIDATION',
      reference: 'Phase13.2 infeasible result semantics',
      status: 'VERIFIED',
    } as any);
    invalid.push({ cand, reason: check.reason ?? 'unknown geometry violation' });
  }
  const ranked = [...valid].sort((a, b) => {
    const c = compareCandidates(a, b);
    if (c !== 0) return c;
    return strategies.indexOf(a.metadata.strategy) - strategies.indexOf(b.metadata.strategy);
  });
  if (ranked.length === 0) {
    const attempts: Array<{ strategy: string; candidateId: string; reason: string }> = [];
    for (const strategy of strategies) {
      const inv = invalid.find(x => x.cand.metadata.strategy === strategy);
      if (inv) attempts.push({ strategy, candidateId: inv.cand.id, reason: inv.reason });
    }
    const diag = [...invalid.map(x => x.cand)].sort((a, b) => {
      const c = compareCandidates(a, b);
      if (c !== 0) return c;
      return strategies.indexOf(a.metadata.strategy) - strategies.indexOf(b.metadata.strategy);
    });
    project.candidates = [];
    project.selectedCandidateId = undefined;
    return {
      project,
      candidates: [],
      bestCandidate: null,
      infeasible: {
        code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
        severity: 'hard',
        explanation:
          `Phase13.2 INFEASIBLE: no geometrically valid candidate — ${attempts.length}/${strategies.length} strategy attempts, ` +
          `0 satisfy the minimum-geometry contract (every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea). ` +
          `First failure per strategy: ${attempts.length ? attempts.map(a => `${a.strategy}: ${a.reason}`).join(' ; ') : 'no candidates were generated'}. ` +
          `bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings. ` +
          `This result must NOT be treated as a normal architectural plan.`,
        attempts,
        attemptedCandidates: all.length,
        diagnosticCandidates: diag,
      },
    };
  }
  const best = ranked[0];
  project.candidates = valid;
  project.selectedCandidateId = best.id;
  return {
    project,
    candidates: opts.allStrategies ? valid : [best],
    bestCandidate: best,
    infeasible: null,
  };
}
