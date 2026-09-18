import type { Floor } from '../model/floor.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding, ValidationResult } from './types.js';
import { validateGeometric } from './geometric.js';
import { validateCirculation } from './circulation.js';
import { validateFurniture } from './furniture.js';
import { validateStairs } from './stair.js';
import { validateArchitecturalQA } from './architectural-qa.js';

export function validateFloor(floor: Floor): Finding[] {
  return [
    ...validateGeometric(floor),
    ...validateCirculation(floor),
    ...validateFurniture(floor),
    ...validateStairs(floor),
    ...validateArchitecturalQA(floor),
  ];
}

export function validateLayout(candidate: LayoutCandidate): ValidationResult {
  const findings: Finding[] = [];
  for (const fl of candidate.floors) findings.push(...validateFloor(fl));

  findings.push(...candidate.findings); // generator/regulator pre-findings

  const hard = findings.filter(f => f.severity === 'hard');
  const soft = findings.filter(f => f.severity === 'soft');
  const advisory = findings.filter(f => f.severity === 'advisory');

  return {
    ok: hard.length === 0,
    findings,
    hard,
    soft,
    advisory,
  };
}

export function summarize(r: ValidationResult): string {
  if (r.ok) {
    return `VALID — ${r.soft.length} soft warning(s), ${r.advisory.length} advisory item(s).`;
  }
  return `INVALID — HARD CONSTRAINT VIOLATION (${r.hard.length}); ${r.soft.length} soft, ${r.advisory.length} advisory.`;
}
