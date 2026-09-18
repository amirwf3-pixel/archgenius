/**
 * High-level, UI-friendly API for ArchGenius core.
 */
import type { ProjectInput, Project } from './model/project.js';
import { PROJECT_SCHEMA_VERSION } from './model/project.js';
import type { LayoutCandidate, CandidateStrategy } from './model/layout.js';
import type { ValidationResult } from './validation/types.js';
import { validateLayout, summarize } from './validation/validator.js';
import { generateLayouts, validateInput } from './generator/generator.js';
import { writeDXF, validateDXFStructure } from './dxf/writer.js';
import { computeMetrics } from './optimizer/metrics.js';

export interface GenerateOptions {
  strategies?: CandidateStrategy[];
  projectName?: string;
  /** If true, return ALL strategies; default returns only the best-ranked. */
  allStrategies?: boolean;
}

export interface GenerateResult {
  project: Project;
  candidates: LayoutCandidate[];
  bestCandidate: LayoutCandidate;
}

export function createProject(input: ProjectInput): Project {
  validateInput(input);
  const now = Date.now();
  return {
    id: `prj-${now.toString(36)}`,
    input: { deterministic: true, ...input },
    candidates: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
}

export function generate(project: Project, opts: GenerateOptions = {}): GenerateResult {
  const strategies = opts.strategies ?? [
    'area-efficiency',
    'functional-circulation',
    'daylight-orientation',
    'alternative-zoning',
  ];
  const all = generateLayouts(project.input, strategies);
  // Rank candidates: fewer constraint violations first, then higher usable-
  // area ratio and daylight exposure. Tie-break by strategy order.
  const scored = all.map(c => ({ c, m: computeMetrics(c) }));
  scored.sort((a, b) => {
    if (a.m.constraintViolations !== b.m.constraintViolations)
      return a.m.constraintViolations - b.m.constraintViolations;
    const as = a.m.usableAreaRatio * 0.35 + a.m.daylightExposure * 0.35 + a.m.adjacencySatisfaction * 0.2 + a.m.privacySatisfaction * 0.1;
    const bs = b.m.usableAreaRatio * 0.35 + b.m.daylightExposure * 0.35 + b.m.adjacencySatisfaction * 0.2 + b.m.privacySatisfaction * 0.1;
    if (Math.abs(as - bs) > 1e-6) return bs - as;
    return strategies.indexOf(a.c.metadata.strategy) - strategies.indexOf(b.c.metadata.strategy);
  });
  const candidates = scored.map(x => x.c);
  const bestCandidate = candidates[0];
  project.candidates = candidates;
  project.selectedCandidateId = bestCandidate.id;
  project.updatedAt = Date.now();
  if (opts.allStrategies) {
    return { project, candidates, bestCandidate };
  }
  return { project, candidates: [bestCandidate], bestCandidate };
}

export function validateCandidate(candidate: LayoutCandidate): ValidationResult {
  return validateLayout(candidate);
}

export function exportDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan'): { dxf: string; validation: ReturnType<typeof validateDXFStructure> } {
  const dxf = writeDXF(candidate, projectName);
  return { dxf, validation: validateDXFStructure(dxf) };
}

export function summarizeValidation(candidate: LayoutCandidate): string {
  return summarize(validateLayout(candidate));
}

export { generateLayouts, writeDXF, validateLayout, summarize, validateInput };
