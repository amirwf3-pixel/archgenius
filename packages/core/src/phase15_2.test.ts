/**
 * Phase 15 M2 — honest HARD-feasibility gate.
 *
 * Contract under test:
 *   1. A candidate is usable ONLY if geometrically valid AND fresh
 *      validateLayout() finds ZERO hard findings (hardClean).
 *   2. When every generated candidate is rejected, the result is an explicit
 *      INFEASIBLE with a deterministic code:
 *        - HARD_CONSTRAINT_INFEASIBLE_DIMENSION (Phase 13.2, byte-identical message)
 *        - HARD_RULE_VIOLATION (new: valid-but-hard-dirty candidates)
 *      with per-strategy residual HARD findings (hardCodes histogram).
 *   3. The gate never weakens/suppresses/reclassifies a validator: demoted
 *      candidates keep ALL their original findings (additive marker only).
 *   4. All output surfaces refuse gate-rejected candidates (diagnostic-only).
 */
import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF, buildDocumentation } from './pipeline.js';
import { validateLayout } from './validation/validator.js';
import type { ProjectInput } from './model/project.js';

function proj(input: { site: any; building: any; seed?: number; name?: string }): ProjectInput {
  return {
    name: input.name ?? 'P15.2',
    site: input.site,
    building: input.building,
    deterministic: true,
    seed: input.seed ?? 42,
    country: 'IR',
  } as any;
}

// 18x25 2F 3BD: every strategy yields a geometrically valid candidate but ALL carry
// residual HARD findings (measured at M1 baseline) → the gate must return HARD_RULE_VIOLATION.
function ruleVariantCase() {
  return proj({
    name: 'P15.2-rule-18x25-2F',
    site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 },
    building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true },
  });
}
// 15x20 2BD: hard-clean candidates exist (3 of 4 strategies at M2); functional-circulation
// carries 1 residual hard and must be demoted.
function mixedCase() {
  return proj({
    name: 'P15.2-mixed-15x20',
    site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8 },
    building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
  });
}
// Pure below-minimum case keeps the Phase 13.2 variant byte-identical (no reclassification).
function dimensionCase() {
  return proj({
    name: 'P15.2-dim-8x10',
    site: { shape: 'rectangle', width: 8, length: 10, accessSide: 'south', streetWidth: 8 },
    building: { type: 'villa', floors: 1, bedrooms: 4, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', parkingSpaces: 0 },
  });
}

describe('Phase 15 M2 A: usable candidates are HARD-clean by construction', () => {
  it('winner + allStrategies usable set carry zero HARD findings (fresh validation)', () => {
    const prj = createProject(mixedCase());
    const res = generate(prj, { allStrategies: true });
    expect(res.bestCandidate).not.toBeNull();
    expect(res.infeasible).toBeNull();
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of res.candidates) {
      expect(validateLayout(c).hard.length).toBe(0);
    }
  });

  it('hard-dirty but geometry-valid strategy is demoted out of the exposed usable set', () => {
    const prj = createProject(mixedCase());
    const res = generate(prj, { allStrategies: true });
    expect(res.candidates.some(c => c.metadata.strategy === 'functional-circulation')).toBe(false);
    // The demoted candidate is not silently dropped — it remains as a diagnostic with its findings.
    const all = generate(createProject(mixedCase()));
    expect(all.bestCandidate).not.toBeNull(); // usable exists → NOT infeasible overall
    // Usable never contains a candidate whose fresh validation has hard findings.
    for (const c of prj.candidates ?? []) {
      expect(validateLayout(c).hard.length).toBe(0);
    }
  });
});

describe('Phase 15 M2 B: all-hard case → explicit deterministic HARD_RULE_VIOLATION', () => {
  it('INFEASIBLE with per-strategy residual HARD histogram; nothing exposed as usable', () => {
    const prj = createProject(ruleVariantCase());
    const res = generate(prj);
    expect(res.bestCandidate).toBeNull();
    expect(res.candidates).toEqual([]);
    expect(prj.candidates).toEqual([]);
    expect(prj.selectedCandidateId).toBeUndefined();
    const inf = res.infeasible!;
    expect(inf).not.toBeNull();
    expect(inf.code).toBe('HARD_RULE_VIOLATION');
    expect(inf.severity).toBe('hard');
    expect(inf.attemptedCandidates).toBe(4);
    expect(inf.attempts.length).toBeGreaterThan(0);
    for (const a of inf.attempts) {
      expect(a.strategy).toBeTruthy();
      expect(a.candidateId).toBeTruthy();
      expect(a.reason).toMatch(/^hardCount=\d+: [A-Z0-9_\-]+ x\d+/);
      expect(Array.isArray(a.hardCodes)).toBe(true);
      expect(a.hardCodes!.length).toBeGreaterThan(0);
      // Histogram deterministic: count-desc, then code-asc.
      for (let i = 1; i < a.hardCodes!.length; i++) {
        const [pc, pn] = a.hardCodes![i - 1];
        const [cc, cn] = a.hardCodes![i];
        expect(cn < pn || (cn === pn && cc.localeCompare(pc) >= 0)).toBe(true);
      }
    }
    expect(inf.explanation).toContain('HARD_RULE_VIOLATION');
    expect(inf.explanation).toContain('bestCandidate is null');
    expect(inf.diagnosticCandidates.length).toBeGreaterThan(0);
    // Every diagnostic keeps its honest findings (validator output not suppressed):
    for (const d of inf.diagnosticCandidates) {
      expect(validateLayout(d).hard.length).toBeGreaterThan(0);
      expect(d.findings.some(f => f.code === 'HARD_RULE_VIOLATION' && f.severity === 'hard')).toBe(true);
    }
  });

  it('deterministic: same input+seed → identical code, explanation, attempts, diagnostics', () => {
    const r1 = generate(createProject(ruleVariantCase()));
    const r2 = generate(createProject(ruleVariantCase()));
    expect(r1.infeasible!.code).toBe(r2.infeasible!.code);
    expect(r1.infeasible!.explanation).toBe(r2.infeasible!.explanation);
    expect(r1.infeasible!.attempts).toEqual(r2.infeasible!.attempts);
    expect(r1.infeasible!.diagnosticCandidates.map(c => c.id)).toEqual(r2.infeasible!.diagnosticCandidates.map(c => c.id));
  });
});

describe('Phase 15 M2 C: the minimum-geometry variant is preserved verbatim', () => {
  it('8x10 4BD: still HARD_CONSTRAINT_INFEASIBLE_DIMENSION with the Phase 13.2 explanation', () => {
    const res = generate(createProject(dimensionCase()));
    expect(res.bestCandidate).toBeNull();
    const inf = res.infeasible!;
    expect(inf.code).toBe('HARD_CONSTRAINT_INFEASIBLE_DIMENSION');
    expect(inf.explanation).toMatch(/^Phase13\.2 INFEASIBLE: no geometrically valid candidate — 4\/4 strategy attempts, 0 satisfy the minimum-geometry contract/);
    for (const a of inf.attempts) expect(a.hardCodes).toBeUndefined();
  });
});

describe('Phase 15 M2 D: downstream output safety on HARD_RULE_VIOLATION diagnostics', () => {
  it('DXF / documentation refuse gate-marked diagnostics; null candidate refuses with INFEASIBLE', () => {
    const input = ruleVariantCase();
    const prj = createProject(input);
    const res = generate(prj);
    const diag = res.infeasible!.diagnosticCandidates[0];
    expect(() => exportDXF(diag, 'P15.2')).toThrow(/diagnostic-only/);
    expect(() => exportDXF(diag, 'P15.2')).toThrow(/HARD_RULE_VIOLATION/);
    expect(() => buildDocumentation(prj, diag)).toThrow(/diagnostic-only/);
    expect(() => exportDXF(res.bestCandidate as any, 'P15.2')).toThrow(/INFEASIBLE/);
    // A gate-rejected candidate is refused regardless of which strategy it came from;
    // the refusal is about the MARKER, not about any specific strategy.
    for (const d of res.infeasible!.diagnosticCandidates) {
      expect(() => exportDXF(d, 'P15.2')).toThrow(/diagnostic-only/);
    }
  });
});
