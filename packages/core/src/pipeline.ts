/**
 * High-level, UI-friendly API for ArchGenius core.
 * Phase 7 adds documentation model & multi-output engine.
 */
import type { ProjectInput, Project } from './model/project.js';
import { PROJECT_SCHEMA_VERSION } from './model/project.js';
import type { LayoutCandidate, CandidateStrategy } from './model/layout.js';
import type { ValidationResult } from './validation/types.js';
import { validateLayout, summarize } from './validation/validator.js';
import { generateLayouts, validateInput } from './generator/generator.js';
import { writeDXF, validateDXFStructure } from './dxf/writer.js';
import { computeMetrics } from './optimizer/metrics.js';
import { buildDocumentationModel } from './documentation/builder.js';
import { generatePDF } from './documentation/pdf.js';
import { generateXLSX } from './documentation/xlsx.js';
import { buildQAReport } from './documentation/report.js';
import { buildManifest } from './documentation/manifest.js';
import type { DocumentationModel } from './documentation/model.js';
import type { QAReport } from './documentation/report.js';
import type { ProjectManifest } from './documentation/manifest.js';
import { compareCandidates } from './layout/ranking.js';

export interface GenerateOptions {
  strategies?: CandidateStrategy[];
  projectName?: string;
  /** If true, return ALL strategies; default returns only the best-ranked. */
  allStrategies?: boolean;
}

/** Phase 13.2: per-strategy diagnostic record for an infeasible generation result. */
export interface InfeasibleStrategyAttempt {
  strategy: CandidateStrategy;
  candidateId: string;
  /** Deterministic first-failing minimum-geometry reason (e.g. "minA master-bedroom a=9.10<12"). */
  reason: string;
}

/**
 * Phase 13.2: explicit INFEASIBLE result state.
 *
 * Returned when NO generated candidate satisfies the minimum-geometry contract
 * (every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea).
 * In this state the project has NO usable candidate:
 *   - GenerateResult.bestCandidate is null
 *   - GenerateResult.candidates is empty
 *   - Project.candidates is empty and Project.selectedCandidateId is undefined
 * diagnosticCandidates are retained for findings/explanation only — they carry
 * HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings and must NEVER be treated as a
 * normal architectural plan (DXF/XLSX/PDF/report/manifest generation refuses them).
 */
export interface InfeasibleResult {
  code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION';
  severity: 'hard';
  /** Deterministic human-readable explanation (same input+seed → same string). */
  explanation: string;
  /** Strategy attempts in the order strategies were requested (deterministic). */
  attempts: InfeasibleStrategyAttempt[];
  /** Number of candidates generated (all invalid/below-minimum). */
  attemptedCandidates: number;
  /** Invalid/below-minimum candidates retained for diagnostics ONLY — never usable plans. */
  diagnosticCandidates: LayoutCandidate[];
}

export interface GenerateResult {
  project: Project;
  /** Usable candidates: geometrically valid ONLY. Empty when infeasible. */
  candidates: LayoutCandidate[];
  /** Best usable candidate. null when no geometrically valid candidate exists (infeasible). */
  bestCandidate: LayoutCandidate | null;
  /** Explicit infeasible state; non-null only when no usable candidate exists. */
  infeasible: InfeasibleResult | null;
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

function isValidRoomGeometry(c: any): { valid: boolean; reason?: string } {
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
      // polygon validity
      if (s.polygon && s.polygon.length < 3) return { valid: false, reason: `invalid polygon ${s.type}` };
    }
  }
  return { valid: true };
}

/**
 * Phase 13.2: deterministic best-first ranking used both for usable candidates (feasible path)
 * and for diagnostic candidates (infeasible path), so that diagnostics[0] is the least-bad
 * attempt — the same candidate the Phase 13.1 fallback would have exposed, now correctly
 * kept out of the usable result.
 */
function rankCandidatesBestFirst(cands: LayoutCandidate[], strategies: CandidateStrategy[]): LayoutCandidate[] {
  const copy = [...cands];
  copy.sort((a, b) => {
    const c = compareCandidates(a, b);
    if (c !== 0) return c;
    return strategies.indexOf(a.metadata.strategy) - strategies.indexOf(b.metadata.strategy);
  });
  return copy;
}

export function generate(project: Project, opts: GenerateOptions = {}): GenerateResult {
  const strategies = opts.strategies ?? [
    'area-efficiency',
    'functional-circulation',
    'daylight-orientation',
    'alternative-zoning',
  ];
  const all = generateLayouts(project.input, strategies);
  // Phase 13.1: final feasibility gate — filter out geometrically invalid candidates (w<=0,h<=0,area<=0,below min)
  // Phase 13.2: when NO valid candidate exists, return an explicit INFEASIBLE result —
  // an invalid/below-min candidate is never selected as bestCandidate and never exposed as usable.
  const validCandidates: typeof all = [];
  const invalidCandidates: Array<{ cand: LayoutCandidate; reason: string }> = [];
  for (const cand of all) {
    const check = isValidRoomGeometry(cand);
    if (check.valid) {
      validCandidates.push(cand);
    } else {
      // Add explicit HARD finding for invalid geometry (preserved from Phase 13.1, reworded for 13.2 semantics)
      cand.findings.push({
        code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
        severity: 'hard',
        message: `Phase13.2 infeasible dimension: ${check.reason} — candidate excluded from usable candidates (diagnostic only); when no valid candidate exists the result is INFEASIBLE with bestCandidate=null`,
        ruleId: 'GEOM_VALIDATION',
        reference: 'Phase13.2 infeasible result semantics',
        status: 'VERIFIED',
      } as any);
      invalidCandidates.push({ cand, reason: check.reason ?? 'unknown geometry violation' });
    }
  }

  // Phase 13.2 CASE A: no geometrically valid candidate → explicit infeasible result, no usable candidate.
  if (validCandidates.length === 0) {
    const attempts: InfeasibleStrategyAttempt[] = [];
    for (const strategy of strategies) {
      const inv = invalidCandidates.find(x => x.cand.metadata.strategy === strategy);
      if (inv) {
        attempts.push({ strategy, candidateId: inv.cand.id, reason: inv.reason });
      }
    }
    const attemptSummary = attempts.length > 0
      ? attempts.map(a => `${a.strategy}: ${a.reason}`).join(' ; ')
      : 'no candidates were generated';
    const explanation =
      `Phase13.2 INFEASIBLE: no geometrically valid candidate — ${attempts.length}/${strategies.length} strategy attempts, ` +
      `0 satisfy the minimum-geometry contract (every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea). ` +
      `First failure per strategy: ${attemptSummary}. ` +
      `bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings. ` +
      `This result must NOT be treated as a normal architectural plan.`;
    const infeasible: InfeasibleResult = {
      code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
      severity: 'hard',
      explanation,
      attempts,
      attemptedCandidates: all.length,
      // Best-first (same comparator as the feasible path): diagnostics[0] is the least-bad attempt.
      diagnosticCandidates: rankCandidatesBestFirst(invalidCandidates.map(x => x.cand), strategies),
    };
    project.candidates = [];
    project.selectedCandidateId = undefined;
    project.updatedAt = Date.now();
    return { project, candidates: [], bestCandidate: null, infeasible };
  }

  // Phase 13.2 feasible path: rank among valid candidates only (invalid ones are never ranked or exposed)
  const candidates = rankCandidatesBestFirst(validCandidates, strategies);
  const bestCandidate = candidates[0];
  project.candidates = validCandidates;
  project.selectedCandidateId = bestCandidate.id;
  project.updatedAt = Date.now();
  if (opts.allStrategies) {
    return { project, candidates: validCandidates, bestCandidate, infeasible: null };
  }
  return { project, candidates: [bestCandidate], bestCandidate, infeasible: null };
}

const INFEASIBLE_DIMENSION_CODE = 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION';

/** Phase 13.2: true for candidates marked infeasible by the minimum-geometry gate (diagnostic-only). */
function isDimensionInfeasibleCandidate(c: LayoutCandidate): boolean {
  return c.findings.some(f => f.code === INFEASIBLE_DIMENSION_CODE);
}

/**
 * Phase 13.2 downstream safety: output generation (DXF/XLSX/PDF/report/manifest)
 * must never silently present an infeasible project as a normal architectural plan.
 * Fails explicitly on a null candidate (infeasible result) or on a diagnostic-only
 * candidate marked HARD_CONSTRAINT_INFEASIBLE_DIMENSION. Valid-geometry candidates
 * with ordinary HARD site/constraint findings are NOT rejected here (CASE B semantics).
 */
function requireUsableCandidate(candidate: LayoutCandidate | null | undefined, operation: string): LayoutCandidate {
  if (!candidate) {
    throw new Error(
      `${operation}: no usable candidate — the project is INFEASIBLE (${INFEASIBLE_DIMENSION_CODE}: no candidate satisfies minimum geometry). ` +
      `Refusing to generate output for an infeasible project; adjust site dimensions or the building program.`,
    );
  }
  if (isDimensionInfeasibleCandidate(candidate)) {
    throw new Error(
      `${operation}: candidate ${candidate.id} is marked ${INFEASIBLE_DIMENSION_CODE} (invalid/below-minimum geometry) and is diagnostic-only. ` +
      `Refusing to generate output that would present it as a normal architectural plan.`,
    );
  }
  return candidate;
}

export function validateCandidate(candidate: LayoutCandidate): ValidationResult {
  if (!candidate) {
    throw new Error('validateCandidate: candidate is null/undefined — the project is INFEASIBLE and has no candidate to validate.');
  }
  return validateLayout(candidate);
}

/**
 * Hard site-envelope geometry violations — findings whose meaning is that
 * generated geometry physically lies outside the site/buildable/footprint
 * envelope (e.g. SITE_WALL_OUTSIDE_BUILDABLE, GEO_ROOM_OUTSIDE_FOOTPRINT).
 * Reuses the existing validation architecture: no new rule is invented, the
 * gate only refuses to export candidates the validator already flags as HARD
 * out-of-envelope. Interior-only findings (e.g. SITE_FURNITURE_OUTSIDE_ROOM)
 * are deliberately NOT part of this envelope set.
 */
const SITE_ENVELOPE_VIOLATION = /^(?:SITE|GEO)_[A-Z]+_OUTSIDE(?:_BUILDABLE|_SITE|_FOOTPRINT)?$/;

export function exportDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan', dxfOptions: { includeGenericLayers?: boolean } = {}): { dxf: string; validation: ReturnType<typeof validateDXFStructure> } {
  requireUsableCandidate(candidate, 'exportDXF');
  const envelopeViolations = validateLayout(candidate).findings.filter(
    (f) => f.severity === 'hard' && SITE_ENVELOPE_VIOLATION.test(f.code),
  );
  if (envelopeViolations.length > 0) {
    const codes = [...new Set(envelopeViolations.map((f) => f.code))].join(', ');
    throw new Error(
      `exportDXF: candidate ${candidate.id} has ${envelopeViolations.length} hard site-envelope geometry violations — geometry lies outside the site/buildable envelope; refusing to export a DXF that would present an out-of-envelope plan as valid CAD geometry. Violations: ${codes}. Adjust the site dimensions or the building program.`,
    );
  }
  const dxf = writeDXF(candidate, projectName, dxfOptions);
  return { dxf, validation: validateDXFStructure(dxf) };
}

export function summarizeValidation(candidate: LayoutCandidate): string {
  if (!candidate) {
    throw new Error('summarizeValidation: candidate is null/undefined — the project is INFEASIBLE and has no candidate to summarize.');
  }
  return summarize(validateLayout(candidate));
}

export function buildDocumentation(project: Project, candidate: LayoutCandidate): DocumentationModel {
  requireUsableCandidate(candidate, 'buildDocumentation');
  return buildDocumentationModel(project, candidate);
}

export async function exportAll(project: Project, candidate: LayoutCandidate): Promise<{
  docModel: DocumentationModel;
  dxf: string;
  pdf: Uint8Array;
  xlsx: Uint8Array;
  report: QAReport;
  manifest: ProjectManifest;
}> {
  // Phase 13.2 downstream safety: refuse to generate a full output set for an infeasible project.
  requireUsableCandidate(candidate, 'exportAll');
  const docModel = buildDocumentationModel(project, candidate);
  const dxf = writeDXF(candidate, project.input.name, { includeGenericLayers: true });
  const pdf = await generatePDF(docModel, candidate);
  const xlsx = await generateXLSX(docModel);
  const report = buildQAReport(docModel);
  const manifest = buildManifest(docModel, project, candidate);
  // Mark outputs as generated
  docModel.outputs.dxf.generated = true;
  docModel.outputs.pdf.generated = true;
  docModel.outputs.xlsx.generated = true;
  docModel.outputs.report.generated = true;
  docModel.outputs.manifest.generated = true;
  return { docModel, dxf, pdf, xlsx, report, manifest };
}

export { generateLayouts, writeDXF, validateLayout, summarize, validateInput };
