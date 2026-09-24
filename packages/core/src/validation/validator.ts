import type { Floor } from '../model/floor.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding, ValidationResult } from './types.js';
import { validateGeometric } from './geometric.js';
import { validateCirculation } from './circulation.js';
import { validateFurniture } from './furniture.js';
import { validateStairs, validateVerticalCirculation } from './stair.js';
import { validateElevators } from './elevator.js';
import { validateArchitecturalQA } from './architectural-qa.js';
import { validateSite } from './site.js';
import { validateProgramCompleteness } from './program-completeness.js';
import { validateParametricConstraints, createInstanceConstraintsFromTypes } from '../layout/parametric-constraints.js';
import { DEFAULT_RESIDENTIAL_CONSTRAINTS } from '../layout/constraints.js';
import { validateRoomSizeConstraints } from '../model/room-constraints.js';

export function validateFloor(floor: Floor): Finding[] {
  return [
    ...validateGeometric(floor),
    ...validateCirculation(floor),
    ...validateFurniture(floor),
    ...validateStairs(floor),
    ...validateArchitecturalQA(floor),
  ];
}

function validateParametricForFloor(floor: Floor): Finding[] {
  const findings: Finding[] = [];
  // Size constraints per space (hard)
  for (const s of floor.spaces) {
    if (s.constraints) {
      const res = validateRoomSizeConstraints(s.area, s.rect, s.constraints);
      for (const f of res.findings) {
        findings.push({
          code: f.code,
          severity: f.severity,
          message: f.message,
          entityIds: [s.id],
        } as Finding);
      }
    }
  }
  // Adjacency type-level -> instance-level (soft in Phase 11.1 for baseline preservation)
  const typeConstraints = DEFAULT_RESIDENTIAL_CONSTRAINTS.map(tc => ({
    id: tc.id,
    kind: tc.kind as any,
    strength: tc.strength,
    fromType: tc.fromType,
    toType: tc.toType,
    note: tc.note,
  }));
  const instanceConstraints = createInstanceConstraintsFromTypes(floor.spaces, typeConstraints as any);
  findings.push(...validateParametricConstraints(floor.spaces, instanceConstraints));
  return findings;
}

export function validateLayout(candidate: LayoutCandidate): ValidationResult {
  const findings: Finding[] = [];
  for (const fl of candidate.floors) {
    findings.push(...validateFloor(fl));
    findings.push(...validateParametricForFloor(fl));
  }
  // v1.0.1 (AGX-02/AGX-05): multi-floor vertical-circulation invariants.
  findings.push(...validateVerticalCirculation(candidate.floors));
  // Elevator shaft geometry invariants (existence / stacking / containment /
  // collisions / landing). Emits nothing for shaft-free plans.
  findings.push(...validateElevators(candidate.floors));

  findings.push(...validateSite(candidate));

  // Phase 15 M3: program completeness — every room the building-level distribution
  // assigned to a floor must exist; placement failures surface as explicit HARD findings.
  findings.push(...validateProgramCompleteness(candidate));

  // Include generator/regulator pre-findings, but deduplicate CONSTRAINT_/ROOM_CONSTRAINT_ etc that are already freshly validated
  // to avoid double counting when validateLayout is called on a candidate that already had findings from previous validation (generator does cand.findings = vr.findings)
  const existingKeys = new Set(findings.map(f => `${f.code}|${(f.entityIds||[]).join(',')}|${f.message}`));
  for (const f of candidate.findings) {
    const key = `${f.code}|${(f.entityIds||[]).join(',')}|${f.message}`;
    if (!existingKeys.has(key)) {
      findings.push(f);
      existingKeys.add(key);
    }
  }

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
