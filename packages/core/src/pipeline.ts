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

export function generate(project: Project, opts: GenerateOptions = {}): GenerateResult {
  const strategies = opts.strategies ?? [
    'area-efficiency',
    'functional-circulation',
    'daylight-orientation',
    'alternative-zoning',
  ];
  const all = generateLayouts(project.input, strategies);
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
  const dxf = writeDXF(candidate, project.input.name);
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
