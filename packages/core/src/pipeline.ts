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
import { compareCandidates, rankVector } from './layout/ranking.js';

export interface GenerateOptions {
  strategies?: CandidateStrategy[];
  projectName?: string;
  /** If true, return ALL strategies; default returns only the best-ranked. */
  allStrategies?: boolean;
  /**
   * P16-C: number of ranked candidates to expose in `candidates` (default 1).
   * A runner-up is included ONLY when it adds clear value — i.e. it beats the
   * winner on at least one ranking dimension (a genuine trade-off); a purely
   * dominated alternative is noise, not choice. The project's full ranked
   * candidate list is always available via `project.candidates`.
   */
  topCandidates?: number;
}

/**
 * Phase 15 M2: explicit INFEASIBLE result state (honest HARD-feasibility gate).
 *
 * A candidate is usable ONLY if it is geometrically valid (the Phase 13.2
 * minimum-geometry contract: every room w>0, h>0, area>0, polygon>=3 vertices,
 * minWidth, minLength, minArea) AND its fresh validateLayout() finds ZERO
 * HARD-severity findings. The gate never weakens, suppresses or reclassifies a
 * validator: it only refuses to SELECT hard-dirty candidates as winners.
 *
 *   - code HARD_CONSTRAINT_INFEASIBLE_DIMENSION (Phase 13.2 CASE A):
 *     NO generated candidate satisfies the minimum-geometry contract.
 *   - code HARD_RULE_VIOLATION (Phase 15 M2):
 *     geometrically valid candidates exist but EVERY one carries >= 1 residual
 *     HARD finding (site envelope, overlap, circulation, stair, regulation…).
 *     Per-strategy residual HARD findings are reported in attempts[].
 *
 * In either state the project has NO usable candidate:
 *   - GenerateResult.bestCandidate is null
 *   - GenerateResult.candidates is empty
 *   - Project.candidates is empty and Project.selectedCandidateId is undefined
 * diagnosticCandidates are retained for findings/explanation only — they carry
 * HARD_CONSTRAINT_INFEASIBLE_DIMENSION or HARD_RULE_VIOLATION findings and must
 * NEVER be treated as a normal architectural plan (DXF/XLSX/PDF/report/manifest
 * generation refuses them).
 */
export interface InfeasibleStrategyAttempt {
  strategy: CandidateStrategy;
  candidateId: string;
  /** Deterministic first-failing reason: below-minimum geometry (e.g. "minA master-bedroom a=9.10<12") for the DIMENSION variant, or the residual HARD histogram (e.g. "hardCount=3: CIRC_INACCESSIBLE_SPACE x1, SITE_WALL_OUTSIDE_BUILDABLE x2") for the RULE variant. */
  reason: string;
  /** Phase 15 M2: residual HARD codes (code, count) — present only for HARD_RULE_VIOLATION attempts. Sorted count-desc, code-asc. */
  hardCodes?: Array<[string, number]>;
}

export type InfeasibleCode = 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION' | 'HARD_RULE_VIOLATION';

export interface InfeasibleResult {
  code: InfeasibleCode;
  severity: 'hard';
  /** Deterministic human-readable explanation (same input+seed → same string). */
  explanation: string;
  /** Strategy attempts in the order strategies were requested (deterministic). */
  attempts: InfeasibleStrategyAttempt[];
  /** Number of candidates generated (all rejected by the gate). */
  attemptedCandidates: number;
  /** Gate-rejected candidates retained for diagnostics ONLY — never usable plans. */
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
  // Phase 15 M2 (honest HARD-feasibility gate): a candidate is usable ONLY if it is
  // geometrically valid AND a fresh validateLayout() reports ZERO hard findings. Valid but
  // hard-dirty candidates are demoted to diagnostic-only; if no usable candidate remains the
  // result is INFEASIBLE with code HARD_RULE_VIOLATION (per-strategy residual HARD findings).
  // No validator is weakened, suppressed, or reclassified by this gate.
  const usableCandidates: LayoutCandidate[] = [];
  const dimInvalid: Array<{ cand: LayoutCandidate; reason: string }> = [];
  const ruleInvalid: Array<{ cand: LayoutCandidate; reason: string; hardCodes: Array<[string, number]> }> = [];
  for (const cand of all) {
    const check = isValidRoomGeometry(cand);
    if (!check.valid) {
      // Add explicit HARD finding for invalid geometry (preserved from Phase 13.1, reworded for 13.2 semantics)
      cand.findings.push({
        code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
        severity: 'hard',
        message: `Phase13.2 infeasible dimension: ${check.reason} — candidate excluded from usable candidates (diagnostic only); when no valid candidate exists the result is INFEASIBLE with bestCandidate=null`,
        ruleId: 'GEOM_VALIDATION',
        reference: 'Phase13.2 infeasible result semantics',
        status: 'VERIFIED',
      } as any);
      dimInvalid.push({ cand, reason: check.reason ?? 'unknown geometry violation' });
      continue;
    }
    // Geometrically valid: fresh honest validation pass — the gate must not trust stale findings.
    const vr = validateLayout(cand);
    if (vr.hard.length > 0) {
      const hist = new Map<string, number>();
      for (const f of vr.hard) {
        const code = String(f.code);
        hist.set(code, (hist.get(code) ?? 0) + 1);
      }
      const hardCodes = [...hist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const reason = `hardCount=${vr.hard.length}: ${hardCodes.map(([c, n]) => `${c} x${n}`).join(', ')}`;
      cand.findings = [
        ...vr.findings,
        {
          code: 'HARD_RULE_VIOLATION',
          severity: 'hard',
          message: `Phase15 M2 rule violation: ${reason} — candidate excluded from usable candidates (diagnostic only); when no hard-clean candidate exists the result is INFEASIBLE with bestCandidate=null`,
          ruleId: 'HARD_FEASIBILITY_GATE',
          reference: 'Phase15 M2 honest HARD-feasibility gate',
          status: 'VERIFIED',
        } as any,
      ];
      ruleInvalid.push({ cand, reason, hardCodes });
      continue;
    }
    usableCandidates.push(cand);
  }

  const rejected = [...dimInvalid.map(x => x.cand), ...ruleInvalid.map(x => x.cand)];
  const rejectedByReason = new Map<string, { reason: string; hardCodes?: Array<[string, number]> }>();
  for (const x of dimInvalid) rejectedByReason.set(x.cand.id, { reason: x.reason });
  for (const x of ruleInvalid) rejectedByReason.set(x.cand.id, { reason: x.reason, hardCodes: x.hardCodes });

  // Phase 15 M2 CASE A: no usable candidate → explicit INFEASIBLE result.
  if (usableCandidates.length === 0) {
    const ruleVariant = ruleInvalid.length > 0; // valid candidates exist, but every one carries residual HARD
    const attempts: InfeasibleStrategyAttempt[] = [];
    for (const strategy of strategies) {
      const rejectedCand = rejected.find(c => c.metadata.strategy === strategy);
      if (rejectedCand) {
        const info = rejectedByReason.get(rejectedCand.id);
        attempts.push({ strategy, candidateId: rejectedCand.id, reason: info?.reason ?? 'unknown', ...(info?.hardCodes ? { hardCodes: info.hardCodes } : {}) });
      }
    }
    const attemptSummary = attempts.length > 0
      ? attempts.map(a => `${a.strategy}: ${a.reason}`).join(' ; ')
      : 'no candidates were generated';
    const explanation = ruleVariant
      ? `Phase15 M2 INFEASIBLE (HARD_RULE_VIOLATION): ${ruleInvalid.length} geometrically valid candidate(s) generated, every one carries residual HARD findings — 0 hard-clean candidates. ` +
        `First residual per strategy: ${attemptSummary}. ` +
        `bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_RULE_VIOLATION findings. ` +
        `This result must NOT be treated as a normal architectural plan.`
      : `Phase13.2 INFEASIBLE: no geometrically valid candidate — ${attempts.length}/${strategies.length} strategy attempts, ` +
        `0 satisfy the minimum-geometry contract (every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea). ` +
        `First failure per strategy: ${attemptSummary}. ` +
        `bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings. ` +
        `This result must NOT be treated as a normal architectural plan.`;
    const infeasible: InfeasibleResult = {
      code: ruleVariant ? 'HARD_RULE_VIOLATION' : 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
      severity: 'hard',
      explanation,
      attempts,
      attemptedCandidates: all.length,
      // Best-first (same comparator as the feasible path): diagnostics[0] is the least-bad
      // attempt — the same candidate the Phase 13.1 fallback would have exposed, now correctly
      // kept out of the usable result (and out of the project's candidates).
      diagnosticCandidates: rankCandidatesBestFirst(rejected, strategies),
    };
    project.candidates = [];
    project.selectedCandidateId = undefined;
    project.updatedAt = Date.now();
    return { project, candidates: [], bestCandidate: null, infeasible };
  }

  // Phase 15 M2 feasible path: rank among usable (hard-clean) candidates only. Hard-dirty valid
  // candidates are never ranked, never selected, never exposed as usable — they are diagnostics.
  const candidates = rankCandidatesBestFirst(usableCandidates, strategies);
  const bestCandidate = candidates[0];
  // P16-C: the stored list is ranked best-first, so the runner-up (candidates[1])
  // is the honest second choice wherever one exists.
  project.candidates = candidates;
  project.selectedCandidateId = bestCandidate.id;
  project.updatedAt = Date.now();
  if (opts.allStrategies) {
    return { project, candidates, bestCandidate, infeasible: null };
  }
  let wantTop = Math.max(1, Math.min(opts.topCandidates ?? 1, candidates.length));
  if (wantTop > 1 && !addsClearValue(candidates[0], candidates[1])) wantTop = 1;
  return { project, candidates: candidates.slice(0, wantTop), bestCandidate, infeasible: null };
}

/**
 * P16-C: a runner-up adds clear value when it strictly beats the winner on at least
 * one ranking dimension (all rankVector dimensions are lower-is-better). Deterministic.
 */
function addsClearValue(best: LayoutCandidate, second: LayoutCandidate): boolean {
  const vb = rankVector(best), vs = rankVector(second);
  for (const k of Object.keys(vb) as (keyof typeof vb)[]) {
    if ((vs[k] as number) < (vb[k] as number) - 1e-6) return true;
  }
  return false;
}

const INFEASIBLE_MARKER_CODES = ['HARD_CONSTRAINT_INFEASIBLE_DIMENSION', 'HARD_RULE_VIOLATION'] as const;

/**
 * Phase 13.2 / Phase 15 M2: true for candidates marked diagnostic-only by the gate —
 * either below the minimum-geometry contract (DIMENSION) or geometrically valid but
 * carrying residual HARD findings (RULE).
 */
function gateMarkerCode(c: LayoutCandidate): string | null {
  for (const code of INFEASIBLE_MARKER_CODES) {
    if (c.findings.some(f => f.code === code)) return code;
  }
  return null;
}

/**
 * Phase 13.2 / Phase 15 M2 downstream safety: output generation (DXF/XLSX/PDF/report/manifest)
 * must never silently present an infeasible project as a normal architectural plan.
 * Fails explicitly on a null candidate (infeasible result) or on a diagnostic-only
 * candidate marked HARD_CONSTRAINT_INFEASIBLE_DIMENSION or HARD_RULE_VIOLATION.
 */
function requireUsableCandidate(candidate: LayoutCandidate | null | undefined, operation: string): LayoutCandidate {
  if (!candidate) {
    throw new Error(
      `${operation}: no usable candidate — the project is INFEASIBLE (HARD_CONSTRAINT_INFEASIBLE_DIMENSION: no candidate satisfies minimum geometry, or HARD_RULE_VIOLATION: no hard-clean candidate). ` +
      `Refusing to generate output for an infeasible project; adjust site dimensions or the building program.`,
    );
  }
  const marker = gateMarkerCode(candidate);
  if (marker) {
    const what = marker === 'HARD_RULE_VIOLATION'
      ? 'geometry-valid but carrying residual HARD findings'
      : 'invalid/below-minimum geometry';
    throw new Error(
      `${operation}: candidate ${candidate.id} is marked ${marker} (${what}) and is diagnostic-only. ` +
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
