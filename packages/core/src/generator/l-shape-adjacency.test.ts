/**
 * Phase 5.3B — opt-in `preferLShapeProgrammeAdjacency`.
 *
 * Two layers:
 *  1. L-wing selection prefers the gate-passing plan with more satisfied programme
 *     adjacency (spec.adjacencies; doorRequired weight first).
 *  2. The resulting candidate is adopted only when the FULL validator confirms it
 *     loses no validity and adds no HARD / circulation / access / daylight finding,
 *     and programme adjacency strictly improves — otherwise the legacy candidate.
 * Fixtures are arbitrary decimal L-shapes (not benchmark geometry).
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, adoptLShapeAdjacencyVariant } from './generator.js';
import { generate, createProject } from '../pipeline.js';
import { writeDXF } from '../dxf/writer.js';
import { computeAdjacencyMetrics, programAdjacencyByType } from '../quality/metrics-v1.js';
import type { LayoutCandidate, CandidateStrategy } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';

const VILLA = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 };
const VILLA_LIFT = { ...VILLA, bedrooms: 3, hasElevator: true, floors: 3 };
const VILLA_4 = { ...VILLA, bedrooms: 4, bathrooms: 2 };
const VILLA_1 = { ...VILLA, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 };

function lInput(w: number, l: number, nw: number, nl: number, corner: string, access: string, street: number,
  sb: [number, number, number, number], building: object, seed: number): ProjectInput {
  return {
    site: { shape: 'l-shape', width: w, length: l, streetWidth: street, accessSide: access,
      setbackNorth: sb[0], setbackSouth: sb[1], setbackEast: sb[2], setbackWest: sb[3],
      lShape: { width: w, length: l, notchWidth: nw, notchLength: nl, notchCorner: corner } },
    building, seed, deterministic: true, jurisdiction: 'IR',
  } as unknown as ProjectInput;
}

// A gate-passing plan with better programme adjacency exists and validates cleanly.
const FEASIBLE = () => lInput(24.12, 23.27, 4.64, 8.18, 'south-west', 'west', 8, [1.9, 2.5, 1.5, 1.4], VILLA_LIFT, 87);
// The L-wing preference alone would pick a plan that loses validity downstream
// (vertical circulation) — the validated adoption must keep the legacy candidate.
const GUARDED = () => lInput(28.58, 30.28, 8.14, 5.33, 'south-west', 'east', 10, [2, 1.3, 2, 2.4], VILLA_4, 78);
// Every better-adjacency wing plan fails a mandatory gate — nothing may change.
const INFEASIBLE = () => lInput(20, 26, 4, 6, 'north-east', 'south', 8, [3, 1.5, 2, 2], VILLA_1, 42);

const ALL: CandidateStrategy[] = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'];
const byStrategy = (cs: LayoutCandidate[], st: string) => cs.find(c => c.metadata.strategy === st)!;
const hard = (c: LayoutCandidate) => c.findings.filter(f => f.severity === 'hard').length;
function adjKey(c: LayoutCandidate, input: ProjectInput): [number, number] {
  let d = 0, t = 0;
  for (const fl of c.floors) for (const x of computeAdjacencyMetrics(fl, programAdjacencyByType(input, fl.level)).instances) {
    if (x.adjacencySatisfied !== true) continue;
    t += x.weight; if (x.doorRequired) d += x.weight;
  }
  return [d, t];
}
const clone = (c: LayoutCandidate): LayoutCandidate => JSON.parse(JSON.stringify(c));

describe('Phase 5.3B preferLShapeProgrammeAdjacency — generator', () => {
  it('feasible: adopts a variant with strictly better programme adjacency, no HARD added, validity kept', () => {
    const off = generateLayouts(FEASIBLE(), ['daylight-orientation'])[0];
    const on = generateLayouts(FEASIBLE(), ['daylight-orientation'], { preferLShapeProgrammeAdjacency: true })[0];
    expect(on.explanations.some(e => e.startsWith('Phase 5.3B'))).toBe(true);
    expect(JSON.stringify(on.floors)).not.toBe(JSON.stringify(off.floors));
    const ko = adjKey(off, FEASIBLE()), kn = adjKey(on, FEASIBLE());
    expect(kn[0] > ko[0] || (kn[0] === ko[0] && kn[1] > ko[1])).toBe(true);
    expect(hard(on)).toBeLessThanOrEqual(hard(off));
    if (off.valid) expect(on.valid).toBe(true);
  });

  it('validity is never sacrificed: a wing plan that fails downstream validation is not adopted', () => {
    const off = generateLayouts(GUARDED(), ALL);
    const on = generateLayouts(GUARDED(), ALL, { preferLShapeProgrammeAdjacency: true });
    for (const st of ALL) {
      const a = byStrategy(off, st), b = byStrategy(on, st);
      if (a.valid) expect(b.valid).toBe(true);
      expect(hard(b)).toBeLessThanOrEqual(hard(a));
    }
    // the two strategies that were HARD-valid stay byte-identical to legacy
    for (const st of ['functional-circulation', 'alternative-zoning']) {
      expect(byStrategy(off, st).valid).toBe(true);
      expect(JSON.stringify(byStrategy(on, st).floors)).toBe(JSON.stringify(byStrategy(off, st).floors));
    }
  });

  it('infeasible adjacency: output unchanged', () => {
    const off = generateLayouts(INFEASIBLE(), ALL);
    const on = generateLayouts(INFEASIBLE(), ALL, { preferLShapeProgrammeAdjacency: true });
    for (const st of ALL) {
      expect(JSON.stringify(byStrategy(on, st).floors)).toBe(JSON.stringify(byStrategy(off, st).floors));
      expect(byStrategy(on, st).findings).toEqual(byStrategy(off, st).findings);
    }
  });

  it('deterministic', () => {
    const a = generateLayouts(FEASIBLE(), ALL, { preferLShapeProgrammeAdjacency: true });
    const b = generateLayouts(FEASIBLE(), ALL, { preferLShapeProgrammeAdjacency: true });
    expect(JSON.stringify(a.map(c => [c.floors, c.findings]))).toBe(JSON.stringify(b.map(c => [c.floors, c.findings])));
  });

  it('omitted / false preserve legacy (generator floors + pipeline DXF)', () => {
    const omit = generateLayouts(FEASIBLE(), ALL);
    const off = generateLayouts(FEASIBLE(), ALL, { preferLShapeProgrammeAdjacency: false });
    expect(JSON.stringify(off.map(c => [c.floors, c.findings]))).toBe(JSON.stringify(omit.map(c => [c.floors, c.findings])));
    const p0 = generate(createProject(GUARDED())).candidates[0];
    const p1 = generate(createProject(GUARDED()), { preferLShapeProgrammeAdjacency: false }).candidates[0];
    expect(p0).toBeDefined();
    expect(writeDXF(p1)).toBe(writeDXF(p0));
  });

  it('rectangular sites are untouched by the option', () => {
    const rect = { ...FEASIBLE(), site: { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } } as unknown as ProjectInput;
    const off = generateLayouts(rect, ALL), on = generateLayouts(rect, ALL, { preferLShapeProgrammeAdjacency: true });
    expect(JSON.stringify(on.map(c => [c.floors, c.findings]))).toBe(JSON.stringify(off.map(c => [c.floors, c.findings])));
  });
});

describe('Phase 5.3B validated adoption guard', () => {
  const input = FEASIBLE();
  const legacy = generateLayouts(input, ['daylight-orientation'])[0];
  const variantOf = () => {
    const v = clone(generateLayouts(input, ['daylight-orientation'], { preferLShapeProgrammeAdjacency: true })[0]);
    v.explanations = v.explanations.filter(e => !e.startsWith('Phase 5.3B'));
    return v;
  };

  it('adopts a strictly better variant with no regression', () => {
    expect(adoptLShapeAdjacencyVariant(clone(legacy), variantOf(), input).floors).not.toEqual(legacy.floors);
  });
  it('rejects when the variant loses validity', () => {
    const l = clone(legacy); l.valid = true;
    const v = variantOf(); v.valid = false;
    expect(adoptLShapeAdjacencyVariant(l, v, input)).toBe(l);
  });
  it('rejects when the variant adds a HARD finding', () => {
    const l = clone(legacy), v = variantOf();
    v.findings = [...v.findings, { code: 'GEO_OVERLAPPING_ROOMS', severity: 'hard', message: 'x' } as never];
    expect(adoptLShapeAdjacencyVariant(l, v, input)).toBe(l);
  });
  it('rejects when the variant adds a circulation / access / daylight finding (any severity)', () => {
    for (const code of ['CIRCULATION_DEAD_END', 'CONSTRAINT_DIRECT_ACCESS', 'ROOM_DAYLIGHT_QUALITY']) {
      const l = clone(legacy), v = variantOf();
      // push the per-code count strictly above the legacy candidate's
      const n = l.findings.filter(f => f.code === code && f.severity === 'soft').length + 1;
      v.findings = [...v.findings.filter(f => !(f.code === code && f.severity === 'soft')),
        ...Array.from({ length: n }, () => ({ code, severity: 'soft', message: 'x' } as never))];
      expect(adoptLShapeAdjacencyVariant(l, v, input)).toBe(l);
    }
  });
  it('rejects when programme adjacency is not strictly better', () => {
    const better = variantOf(), l = clone(legacy);
    // swapped roles: the legacy layout is never an improvement over the variant
    expect(adoptLShapeAdjacencyVariant(better, l, input)).toBe(better);
    // identical layouts are never adopted
    const same = clone(legacy);
    expect(adoptLShapeAdjacencyVariant(l, same, input)).toBe(l);
  });
});
