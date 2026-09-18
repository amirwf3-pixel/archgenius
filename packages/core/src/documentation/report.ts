/**
 * Phase 7.5 — QA / Regulation Report
 *
 * Structured report from existing validation/regulation results.
 * Preserves rule ID, title, status, severity, actual, threshold, source, edition, page, clause, result, explanation.
 * Preserves VERIFIED, REQUIRES_SOURCE_VERIFICATION, NOT_IMPLEMENTED, DEPRECATED and HARD/SOFT/ADVISORY.
 * Distinguishes heuristic vs verified regulation.
 */

import type { DocumentationModel, QAFinding, RegulationFinding } from './model.js';

export interface QAReport {
  project: { id: string; name: string };
  generation: { timestamp: string; softwareVersion: string; seed: number; strategy: string };
  summary: {
    totalFindings: number;
    hard: number;
    soft: number;
    advisory: number;
    verifiedRegulations: number;
    requiresVerification: number;
    notImplemented: number;
    heuristicCount: number;
  };
  qaFindings: QAFinding[];
  regulationFindings: RegulationFinding[];
  areaSummary: DocumentationModel['areaSummary'];
  roomSchedule: DocumentationModel['roomSchedule'];
  assumptions: DocumentationModel['assumptions'];
  consistency: DocumentationModel['consistency'];
  metadata: {
    version: string;
    generatedAt: string;
    schemaVersion: number;
  };
}

export function buildQAReport(docModel: DocumentationModel): QAReport {
  const hard = docModel.qaFindings.filter(f => f.severity === 'hard').length + docModel.regulationFindings.filter(f => f.severity === 'hard').length;
  const soft = docModel.qaFindings.filter(f => f.severity === 'soft').length + docModel.regulationFindings.filter(f => f.severity === 'soft').length;
  const advisory = docModel.qaFindings.filter(f => f.severity === 'advisory').length + docModel.regulationFindings.filter(f => f.severity === 'advisory').length;

  const verified = docModel.regulationFindings.filter(f => f.status === 'VERIFIED').length;
  const requires = docModel.regulationFindings.filter(f => f.status === 'REQUIRES_SOURCE_VERIFICATION').length;
  const notImpl = docModel.regulationFindings.filter(f => f.status === 'NOT_IMPLEMENTED').length;
  const heuristic = docModel.qaFindings.filter(f => f.isHeuristic).length;

  return {
    project: { id: docModel.project.id, name: docModel.project.name },
    generation: {
      timestamp: docModel.generation.timestamp,
      softwareVersion: docModel.generation.softwareVersion,
      seed: docModel.generation.seed,
      strategy: docModel.generation.strategy,
    },
    summary: {
      totalFindings: docModel.qaFindings.length + docModel.regulationFindings.length,
      hard,
      soft,
      advisory,
      verifiedRegulations: verified,
      requiresVerification: requires,
      notImplemented: notImpl,
      heuristicCount: heuristic,
    },
    qaFindings: [...docModel.qaFindings].sort((a, b) => a.code.localeCompare(b.code)),
    regulationFindings: [...docModel.regulationFindings].sort((a, b) => a.ruleId.localeCompare(b.ruleId)),
    areaSummary: docModel.areaSummary,
    roomSchedule: docModel.roomSchedule,
    assumptions: docModel.assumptions,
    consistency: docModel.consistency,
    metadata: {
      version: '1.0.0-phase7-report',
      generatedAt: new Date().toISOString(),
      schemaVersion: docModel.revision.schemaVersion,
    },
  };
}

export function validateReport(report: QAReport): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!report.project.id) errors.push('Missing project id');
  if (!report.generation.timestamp) errors.push('Missing timestamp');
  if (!report.qaFindings) errors.push('Missing qaFindings');
  if (!report.regulationFindings) errors.push('Missing regulationFindings');
  // Check statuses preserved
  for (const rf of report.regulationFindings) {
    if (!['VERIFIED', 'REQUIRES_SOURCE_VERIFICATION', 'NOT_IMPLEMENTED', 'DEPRECATED'].includes(rf.status)) {
      // Allow other statuses but warn if heuristic misrepresented
      if (rf.status === 'VERIFIED' && (rf as any).isHeuristic) {
        errors.push(`Heuristic falsely marked VERIFIED: ${rf.ruleId}`);
      }
    }
  }
  // Check heuristic distinction
  for (const qf of report.qaFindings) {
    if (qf.isHeuristic && qf.code.startsWith('REG_')) {
      errors.push(`Heuristic code with REG_ prefix: ${qf.code}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
