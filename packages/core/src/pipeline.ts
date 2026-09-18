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

export function generate(project: Project, opts: GenerateOptions = {}): GenerateResult {
  const strategies = opts.strategies ?? [
    'area-efficiency',
    'functional-circulation',
    'daylight-orientation',
    'alternative-zoning',
  ];
  const all = generateLayouts(project.input, strategies);
  // Phase 13.1: final feasibility gate — filter out geometrically invalid candidates (w<=0,h<=0,area<=0,below min)
  const validCandidates: typeof all = [];
  const invalidCandidates: typeof all = [];
  for (const cand of all) {
    const check = isValidRoomGeometry(cand);
    if (check.valid) {
      validCandidates.push(cand);
    } else {
      // Add explicit HARD finding for invalid geometry
      cand.findings.push({
        code: 'HARD_CONSTRAINT_INFEASIBLE_DIMENSION',
        severity: 'hard',
        message: `Phase13.1 invalid geometry filtered: ${check.reason} — explicit HARD infeasibility, no valid candidate with invalid geometry`,
        ruleId: 'GEOM_VALIDATION',
        reference: 'Phase13.1 feasibility gate',
        status: 'VERIFIED',
      } as any);
      invalidCandidates.push(cand);
    }
  }
  // If we have at least one geometrically valid candidate, rank among valid only
  const toRank = validCandidates.length > 0 ? validCandidates : all;
  const scored = toRank.map(c => {
    const m = computeMetrics(c);
    const hardCount = c.findings.filter(f => f.severity === 'hard').length;
    const softCount = c.findings.filter(f => f.severity === 'soft').length;
    // For validCandidates path, hardCount already excludes invalid geometry; for fallback all path, invalid geometry already has extra hard
    return { c, m, hardCount, softCount };
  });
  scored.sort((a, b) => {
    if (a.hardCount !== b.hardCount) return a.hardCount - b.hardCount;
    if (a.softCount !== b.softCount) return a.softCount - b.softCount;
    const as = a.m.usableAreaRatio * 0.35 + a.m.daylightExposure * 0.35 + a.m.adjacencySatisfaction * 0.2 + a.m.privacySatisfaction * 0.1;
    const bs = b.m.usableAreaRatio * 0.35 + b.m.daylightExposure * 0.35 + b.m.adjacencySatisfaction * 0.2 + b.m.privacySatisfaction * 0.1;
    if (Math.abs(as - bs) > 1e-6) return bs - as;
    return strategies.indexOf(a.c.metadata.strategy) - strategies.indexOf(b.c.metadata.strategy);
  });
  const candidates = scored.map(x => x.c);
  const bestCandidate = candidates[0];
  // If validCandidates empty, bestCandidate is from invalid set but now has explicit HARD and no negative dimensions (primary fix ensures positive)
  // For strict Phase13.1 semantics, if all invalid, we still return best with HARD, but geometry must be valid (positive dims) — primary fix guarantees that
  project.candidates = validCandidates.length > 0 ? validCandidates : candidates;
  if (validCandidates.length === 0 && candidates.length > 0) {
    // No valid candidate — mark project with explicit infeasibility explanation
    bestCandidate.explanations.push(`Phase13.1: no geometrically valid candidate — all ${all.length} attempts produced invalid geometry, explicit HARD_CONSTRAINT_INFEASIBLE_DIMENSION, no valid candidate exposed`);
  }
  project.selectedCandidateId = bestCandidate.id;
  project.updatedAt = Date.now();
  if (opts.allStrategies) {
    return { project, candidates: validCandidates.length > 0 ? validCandidates : candidates, bestCandidate };
  }
  return { project, candidates: [bestCandidate], bestCandidate };
}

export function validateCandidate(candidate: LayoutCandidate): ValidationResult {
  return validateLayout(candidate);
}

export function exportDXF(candidate: LayoutCandidate, projectName = 'ArchGenius Plan', dxfOptions: { includeGenericLayers?: boolean } = {}): { dxf: string; validation: ReturnType<typeof validateDXFStructure> } {
  const dxf = writeDXF(candidate, projectName, dxfOptions);
  return { dxf, validation: validateDXFStructure(dxf) };
}

export function summarizeValidation(candidate: LayoutCandidate): string {
  return summarize(validateLayout(candidate));
}

export function buildDocumentation(project: Project, candidate: LayoutCandidate): DocumentationModel {
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
