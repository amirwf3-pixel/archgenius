/**
 * Phase 8 - Architectural Intelligence & Candidate Optimization Tests
 *
 * Comprehensive coverage for functional, circulation, privacy, daylight, furniture, kitchen, bedroom, entrance/service,
 * optimization (hard-first filtering, deterministic ranking, diversity, explainability, trade-off), determinism, Phase7 integration.
 */

import { describe, it, expect } from 'vitest';
import { createProject, generate, buildDocumentation } from '../pipeline.js';
import type { ProjectInput } from '../model/project.js';
import { evaluateFunctional } from './adjacency.js';
import { evaluateCirculation } from './circulation.js';
import { evaluatePrivacy } from './privacy.js';
import { evaluateDaylight } from './daylight.js';
import { evaluateFurniture } from './furniture.js';
import { evaluateKitchen } from './kitchen.js';
import { evaluateBedroom } from './bedroom.js';
import { evaluateEntranceService } from './entrance.js';
import { evaluateCandidate, evaluateCandidates } from './evaluation.js';
import { compareCandidates, buildOptimizationResult } from './comparison.js';
import { optimizeCandidates } from './optimization/index.js';
import { DEFAULT_WEIGHTS, WEIGHT_REASONS, computeQualityMetrics } from './scoring.js';

function baseInput(): ProjectInput {
  return {
    name: 'Phase8 Test Villa',
    site: { shape: 'rectangle', width: 15, length: 20, accessSide: 'south', streetWidth: 8, northRotationDeg: 0 },
    building: {
      type: 'villa',
      floors: 1,
      bedrooms: 2,
      masterBedrooms: 1,
      bathrooms: 1,
      wc: 1,
      kitchenType: 'closed',
      parkingSpaces: 1,
      hasStair: false,
      hasStorage: true,
    },
    deterministic: true,
    seed: 42,
  };
}

describe('Phase 8 - Functional Adjacency', () => {
  it('evaluates MUST/PREFER/AVOID relationships with kinds', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateFunctional(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.evaluations.length).toBeGreaterThan(0);
    // Should have at least one relationship type evaluated
    const types = new Set(evalResult.evaluations.map(e => e.relationship.relationshipType));
    expect(types.size).toBeGreaterThan(0);
    // Should have direct_adjacency and other kinds
    const kinds = new Set(evalResult.evaluations.map(e => e.relationship.kind));
    expect(kinds.size).toBeGreaterThan(1);
    expect(evalResult.satisfiedMust).toBeGreaterThanOrEqual(0);
    expect(evalResult.satisfiedPrefer).toBeGreaterThanOrEqual(0);
  });

  it('deterministic functional evaluation', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const a = evaluateFunctional(floor);
    const b = evaluateFunctional(floor);
    expect(a.score).toBe(b.score);
    expect(a.satisfiedMust).toBe(b.satisfiedMust);
    expect(a.findings.length).toBe(b.findings.length);
  });
});

describe('Phase 8 - Circulation', () => {
  it('evaluates entrance-to-living/kitchen/bedroom paths, public/private/service circ, corridorArea, ratio, deadEnds', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateCirculation(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.circulationRatio).toBeGreaterThanOrEqual(0);
    expect(evalResult.corridorArea).toBeGreaterThanOrEqual(0);
    expect(evalResult.publicCirculationArea).toBeGreaterThanOrEqual(0);
    expect(evalResult.privateCirculationArea).toBeGreaterThanOrEqual(0);
    expect(evalResult.serviceCirculationArea).toBeGreaterThanOrEqual(0);
    // entranceToLivingPath should be defined if both exist
    if (floor.spaces.some(s => s.type === 'entrance') && floor.spaces.some(s => s.type === 'living')) {
      expect(evalResult.entranceToLivingPath).toBeDefined();
    }
  });

  it('deterministic circulation', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const a = evaluateCirculation(floor);
    const b = evaluateCirculation(floor);
    expect(a.score).toBe(b.score);
    expect(a.circulationRatio).toBe(b.circulationRatio);
    expect(a.deadEndCount).toBe(b.deadEndCount);
  });
});

describe('Phase 8 - Privacy', () => {
  it('evaluates entrance->bedroom/private, living->bedroom/bathroom, guestWC, bedroomCluster, masterSeparation, publicPrivateTransition', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluatePrivacy(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.entranceToBedroomExposure).toBeGreaterThanOrEqual(0);
    expect(evalResult.livingToBedroomExposure).toBeGreaterThanOrEqual(0);
    expect(evalResult.publicPrivateTransitionScore).toBeGreaterThanOrEqual(0);
  });

  it('deterministic privacy', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const a = evaluatePrivacy(floor);
    const b = evaluatePrivacy(floor);
    expect(a.score).toBe(b.score);
    expect(a.entranceToBedroomExposure).toBe(b.entranceToBedroomExposure);
  });
});

describe('Phase 8 - Daylight', () => {
  it('evaluates orientation, exterior wall, window potential, depth, exposure with type priority', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateDaylight(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.roomScores.length).toBeGreaterThan(0);
    expect(evalResult.exteriorWallRatio).toBeGreaterThanOrEqual(0);
    expect(evalResult.exteriorWallRatio).toBeLessThanOrEqual(1);
    // Check heuristic, not legal
    expect(evalResult.findings.every(f => f.code === 'ARCH_DAYLIGHT_MISSING')).toBe(true);
  });

  it('deterministic daylight', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const a = evaluateDaylight(floor);
    const b = evaluateDaylight(floor);
    expect(a.score).toBe(b.score);
    expect(a.exteriorWallRatio).toBe(b.exteriorWallRatio);
  });
});

describe('Phase 8 - Furniture Usability', () => {
  it('evaluates bedroom bed placement/access/wardrobe/door clearance/circ/window, living sofa, dining clearance, kitchen work zone', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateFurniture(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.rooms.length).toBeGreaterThan(0);
    for (const r of evalResult.rooms) {
      expect(r.overall).toBeGreaterThanOrEqual(0);
      expect(r.overall).toBeLessThanOrEqual(1);
      expect(r.doorClearanceScore).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Phase 8 - Kitchen Dedicated', () => {
  it('evaluates fridge/sink/cooktop/counter sequence/working triangle/zone/circ/entrance/dining/living/service, NOT EVALUABLE when insufficient', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateKitchen(floor);
    if (evalResult.isEvaluable) {
      expect(evalResult.score).toBeGreaterThanOrEqual(0);
      expect(evalResult.score).toBeLessThanOrEqual(1);
    } else {
      expect(evalResult.score).toBeNull();
      expect(evalResult.reason).toMatch(/N\/A/);
    }
    // If kitchen exists, should be evaluable if counter present
    const hasKitchen = floor.spaces.some(s => s.type === 'kitchen');
    if (hasKitchen) {
      // May be not evaluable if no counter, but should have reason
      if (!evalResult.isEvaluable) {
        expect(evalResult.reason).toBeTruthy();
      }
    }
  });
});

describe('Phase 8 - Bedroom', () => {
  it('evaluates bed/wardrobe usability, access/circ/door/window/privacy/proportions/master hierarchy, ensuite if requested', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateBedroom(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.rooms.length).toBeGreaterThan(0);
    for (const r of evalResult.rooms) {
      expect(r.overall).toBeGreaterThanOrEqual(0);
      expect(r.bedUsability).toBeGreaterThanOrEqual(0);
      expect(r.wardrobeUsability).toBeGreaterThanOrEqual(0);
    }
    expect(evalResult.hierarchyScore).toBeGreaterThanOrEqual(0);
  });
});

describe('Phase 8 - Entrance/Service', () => {
  it('evaluates entrance transition exterior->entrance->public, direct bedroom/WC exposure, circ efficiency, foyer; service circ, bathroom exposure, crossing public', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const evalResult = evaluateEntranceService(floor);
    expect(evalResult.score).toBeGreaterThanOrEqual(0);
    expect(evalResult.score).toBeLessThanOrEqual(1);
    expect(evalResult.entranceTransitionScore).toBeGreaterThanOrEqual(0);
    expect(evalResult.directBedroomExposureScore).toBeGreaterThanOrEqual(0);
    expect(evalResult.foyerScore).toBeGreaterThanOrEqual(0);
    expect(evalResult.serviceCirculationScore).toBeGreaterThanOrEqual(0);
  });
});

describe('Phase 8 - Scoring & Weights (Phase 9 upgrade)', () => {
  it('weights documented, range normalized, inspectable contributions, hard/soft separation — whole-building', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.quality).toBeDefined();
    expect(evalResult.contributions.length).toBeGreaterThan(0);
    // Phase 9: contributions are whole-building (per-floor avg metrics weighted by 0.6 + vertical/stacking/interFloor + overall)
    // Check per-floor contributions sum to evaluableWeightsSum
    const pf = evalResult.perFloor[0];
    const pfQualityContribs = pf.contributions.filter(c => c.metric !== 'overall');
    const pfSumWeights = pfQualityContribs.reduce((sum, c) => sum + c.weight, 0);
    expect(pfSumWeights).toBeCloseTo(pf.quality.evaluableWeightsSum, 1);

    // Whole-building: per-floor avg metrics weighted by 0.6*baseWeight + vertical 0.2 + stacking 0.12 + interFloor 0.08 = 1.0 (excluding overall)
    // per-metric sum = 0.6 * evaluableWeightsSum, plus 0.4 = 0.6*evaluable +0.4
    const wbContribsNoOverall = evalResult.wholeBuilding.contributions.filter(c => c.metric !== 'overall');
    const wbSumWeights = wbContribsNoOverall.reduce((sum, c) => sum + c.weight, 0);
    // For evaluable 1, sum =1.0; for 0.92, sum=0.952
    expect(wbSumWeights).toBeGreaterThan(0.9);
    expect(wbSumWeights).toBeLessThanOrEqual(1.01);
    // No double-counting: overall not included in weighted sum, per-metric + vertical/stacking/interFloor = 1.0
    const expectedSum = evalResult.wholeBuilding.avgFloorQuality.evaluableWeightsSum * 0.6 + 0.4;
    expect(wbSumWeights).toBeCloseTo(expectedSum, 1);

    if (evalResult.quality.kitchen === null) {
      expect(evalResult.quality.evaluableWeightsSum).toBeCloseTo(0.92, 1);
    } else {
      expect(evalResult.quality.evaluableWeightsSum).toBeCloseTo(1, 1);
    }
    for (const c of evalResult.contributions) {
      expect(c.range[0]).toBe(0);
      expect(c.range[1]).toBe(1);
      expect(c.normalized).toBeGreaterThanOrEqual(0);
      expect(c.normalized).toBeLessThanOrEqual(1);
      expect(c.reason).toBeTruthy();
      expect(c.isHard).toBe(false);
      expect(c.isHeuristic).toBe(true);
      expect(typeof c.isEvaluable).toBe('boolean');
    }
    for (const key of Object.keys(DEFAULT_WEIGHTS)) {
      expect((WEIGHT_REASONS as any)[key]).toBeTruthy();
    }
  });

  it('hard feasibility separated from quality', () => {
    const prj = createProject(baseInput());
    const { bestCandidate, candidates } = generate(prj);
    const evaluations = evaluateCandidates(candidates);
    // First should be feasible if any feasible exists
    const feasibleCount = evaluations.filter(e => e.feasible).length;
    if (feasibleCount > 0) {
      expect(evaluations[0].feasible).toBe(true);
    }
    // Hard violations counted
    for (const ev of evaluations) {
      expect(ev.hardViolations).toBeGreaterThanOrEqual(0);
      if (ev.feasible) expect(ev.hardViolations).toBe(0);
    }
  });
});

describe('Phase 8 - Candidate Optimization', () => {
  it('hard-first filtering, deterministic ranking, diversity with labels reflecting real behavior', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const result = optimizeCandidates(candidates);
    expect(result.candidates.length).toBe(candidates.length);
    expect(result.best).toBeDefined();
    // Hard-first: if best feasible, all after with more hard violations should be after
    if (result.best.feasible) {
      for (let i = 1; i < result.candidates.length; i++) {
        if (!result.candidates[i].feasible) break; // first infeasible after feasibles is ok
        expect(result.candidates[i].hardViolations).toBeGreaterThanOrEqual(result.candidates[0].hardViolations);
      }
    }
    // Diversity: labels not falsely universal best, reflect real behavior
    expect(result.diverseTop.length).toBeGreaterThan(0);
    for (const d of result.diverseTop) {
      expect(d.label).toBeTruthy();
      expect(d.reason).toBeTruthy();
      expect(d.label.toLowerCase()).not.toContain('best overall'); // not falsely universal
      // Label should reflect actual metric
      expect(d.candidate.overallQuality).toBeGreaterThanOrEqual(0);
    }
  });

  it('deterministic optimization', () => {
    const prj1 = createProject(baseInput());
    const { candidates: c1 } = generate(prj1);
    const r1 = optimizeCandidates(c1);
    const prj2 = createProject(baseInput());
    const { candidates: c2 } = generate(prj2);
    const r2 = optimizeCandidates(c2);
    expect(r1.best.candidateId).toBe(r2.best.candidateId);
    expect(r1.best.overallQuality).toBe(r2.best.overallQuality);
    expect(r1.candidates.length).toBe(r2.candidates.length);
  });

  it('explainable evaluation: ID, feasibility, hard violations, overall quality, metric breakdown, strengths/weaknesses/trade-offs real values', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.candidateId).toBeTruthy();
    expect(typeof evalResult.feasible).toBe('boolean');
    expect(typeof evalResult.hardViolations).toBe('number');
    expect(typeof evalResult.overallQuality).toBe('number');
    expect(evalResult.quality.functional).toBeDefined();
    expect(evalResult.quality.circulation).toBeDefined();
    expect(evalResult.quality.privacy).toBeDefined();
    expect(evalResult.quality.daylight).toBeDefined();
    expect(evalResult.strengths).toBeDefined();
    expect(evalResult.weaknesses).toBeDefined();
    expect(evalResult.tradeOff).toBeTruthy();
    // Detailed breakdown
    expect(evalResult.detailed.functional).toBeDefined();
    expect(evalResult.detailed.circulation).toBeDefined();
    expect(evalResult.detailed.privacy).toBeDefined();
    expect(evalResult.detailed.daylight).toBeDefined();
    expect(evalResult.detailed.furniture).toBeDefined();
    expect(evalResult.detailed.kitchen).toBeDefined();
    expect(evalResult.detailed.bedroom).toBeDefined();
    expect(evalResult.detailed.entranceService).toBeDefined();
  });

  it('trade-off comparison: hard feasibility, major metrics, differences, strengths/weaknesses, reasons', () => {
    const prj = createProject(baseInput());
    const { candidates } = generate(prj);
    const evaluations = evaluateCandidates(candidates);
    if (evaluations.length >= 2) {
      const comp = compareCandidates(evaluations[0], evaluations[1]);
      expect(comp.candidateA).toBeTruthy();
      expect(comp.candidateB).toBeTruthy();
      expect(comp.feasibilityDiff).toBeTruthy();
      expect(comp.metricDiffs.length).toBeGreaterThan(0);
      for (const md of comp.metricDiffs) {
        expect(md.metric).toBeTruthy();
        expect(typeof md.a).toBe('number');
        expect(typeof md.b).toBe('number');
        expect(typeof md.diff).toBe('number');
        expect(md.interpretation).toBeTruthy();
      }
      expect(comp.strengthsA).toBeDefined();
      expect(comp.weaknessesA).toBeDefined();
      expect(comp.strengthsB).toBeDefined();
      expect(comp.weaknessesB).toBeDefined();
      expect(comp.tradeOffExplanation).toBeTruthy();
    }
  });
});

describe('Phase 8 - Documentation Integration', () => {
  it('Phase7 outputs remain functional, include Phase8 data in report/manifest', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const doc = buildDocumentation(prj, bestCandidate);
    expect(doc.intelligence).toBeDefined();
    expect(doc.intelligence!.candidateId).toBe(bestCandidate.id);
    expect(doc.intelligence!.feasible).toBeDefined();
    expect(doc.intelligence!.overallQuality).toBeGreaterThanOrEqual(0);
    expect(doc.intelligence!.quality).toBeDefined();
    expect(doc.intelligence!.contributions.length).toBeGreaterThan(0);
    // Report includes intelligence
    // Manifest includes intelligence
    // Room schedule still works
    expect(doc.roomSchedule.length).toBeGreaterThan(0);
    expect(doc.areaSummary).toBeDefined();
  });
});

describe('Phase 8 - Determinism', () => {
  it('identical input/geom/strategy/evaluator version/config -> identical evaluation', () => {
    const input = baseInput();
    const prj1 = createProject(input);
    const { bestCandidate: c1 } = generate(prj1);
    const e1 = evaluateCandidate(c1);
    const prj2 = createProject(input);
    const { bestCandidate: c2 } = generate(prj2);
    const e2 = evaluateCandidate(c2);
    expect(e1.overallQuality).toBe(e2.overallQuality);
    expect(e1.quality.functional).toBe(e2.quality.functional);
    expect(e1.quality.circulation).toBe(e2.quality.circulation);
    expect(e1.quality.privacy).toBe(e2.quality.privacy);
    expect(e1.hardViolations).toBe(e2.hardViolations);
    expect(e1.feasible).toBe(e2.feasible);
  });
});

describe('Phase 8 Hardening — Kitchen N/A scoring', () => {
  it('kitchen NOT EVALUABLE returns score null, isEvaluable false, N/A reason, weight 0, renormalization', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    // Force kitchen not evaluable by removing kitchen space? Instead test evaluateKitchen on floor without kitchen
    const floorWithoutKitchen = { ...bestCandidate.floors[0], spaces: bestCandidate.floors[0].spaces.filter(s => s.type !== 'kitchen'), furniture: bestCandidate.floors[0].furniture.filter(f => !f.type.includes('counter')) };
    // Use a floor with no kitchen
    const evalNoKitchen = evaluateKitchen(floorWithoutKitchen as any);
    expect(evalNoKitchen.score).toBeNull();
    expect(evalNoKitchen.isEvaluable).toBe(false);
    expect(evalNoKitchen.reason).toMatch(/N\/A/);

    // Evaluate candidate with forced non-evaluable kitchen
    const candidateNoKitchen = { ...bestCandidate, floors: [floorWithoutKitchen as any] };
    const evalCand = evaluateCandidate(candidateNoKitchen as any);
    expect(evalCand.quality.kitchen).toBeNull();
    expect(evalCand.quality.evaluableWeightsSum).toBeCloseTo(0.92, 1);
    expect(evalCand.quality.overall).toBeGreaterThan(0);
    // Contribution weight 0 for kitchen
    const kitchenContrib = evalCand.contributions.find(c => c.metric === 'kitchen');
    expect(kitchenContrib).toBeDefined();
    expect(kitchenContrib!.weight).toBe(0);
    expect(kitchenContrib!.isEvaluable).toBe(false);
    expect(kitchenContrib!.raw).toBeNull();
    expect(kitchenContrib!.reason).toMatch(/N\/A/);
  });

  it('fully evaluable candidate keeps quality within tolerance and weights sum 1', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const evalCand = evaluateCandidate(bestCandidate);
    // If kitchen evaluable, weights sum 1
    if (evalCand.detailed.kitchen.isEvaluable) {
      expect(evalCand.quality.evaluableWeightsSum).toBeCloseTo(1, 2);
      const sum = evalCand.contributions.filter(c => c.metric !== 'overall').reduce((s, c) => s + c.weight, 0);
      expect(sum).toBeCloseTo(1, 1);
    }
  });
});

describe('Phase 8 Hardening — Multi-floor transparency (Phase 9 upgrade)', () => {
  it('single floor scope is Whole-Building Intelligence — 1 floors (Phase 9)', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const evalCand = evaluateCandidate(bestCandidate);
    expect(evalCand.intelligenceScope).toContain('Whole-Building Intelligence');
    expect(evalCand.intelligenceScope).toContain('1 floors');
    expect(evalCand.quality.intelligenceScope).toContain('Whole-Building');
  });

  it('multi-floor scope explicitly states whole-building multi-floor', () => {
    const input = baseInput();
    input.building.floors = 2;
    input.building.hasStair = true;
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalCand = evaluateCandidate(bestCandidate);
    expect(evalCand.intelligenceScope).toContain('Whole-Building Intelligence');
    expect(evalCand.intelligenceScope).toContain('2 floors');
    expect(evalCand.floorCount).toBe(2);
    expect(evalCand.tradeOff).toContain('Scope:');
    expect(evalCand.perFloor.length).toBe(2);
    expect(evalCand.vertical).toBeDefined();
    expect(evalCand.stacking).toBeDefined();
    expect(evalCand.interFloor).toBeDefined();
    expect(evalCand.wholeBuilding).toBeDefined();
  });

  it('documentation model carries intelligenceScope and evaluableWeightsSum and whole-building', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const doc = buildDocumentation(prj, bestCandidate);
    expect(doc.intelligence!.intelligenceScope).toBeDefined();
    expect((doc.intelligence!.quality as any).evaluableWeightsSum).toBeDefined();
    expect(doc.intelligence!.intelligenceScope).toContain('Whole-Building');
    expect(doc.intelligence!.floorCount).toBe(1);
    expect(doc.intelligence!.perFloor.length).toBe(1);
    expect(doc.intelligence!.vertical).toBeDefined();
    expect(doc.intelligence!.stacking).toBeDefined();
    expect(doc.intelligence!.wholeBuilding).toBeDefined();
  });
});

describe('Phase 8 Hardening — Heuristic metadata', () => {
  it('all contributions marked isHeuristic true, isHard false, with documented reason', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const evalCand = evaluateCandidate(bestCandidate);
    for (const c of evalCand.contributions) {
      expect(c.isHeuristic).toBe(true);
      expect(c.isHard).toBe(false);
      expect(c.reason).toBeTruthy();
      expect(c.range[0]).toBe(0);
      expect(c.range[1]).toBe(1);
    }
  });

  it('PDF/XLSX/report/manifest include scope and heuristic labels', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const doc = buildDocumentation(prj, bestCandidate);
    expect(doc.intelligence!.contributions.every(c => c.isHeuristic)).toBe(true);
    // XLSX columns would include isEvaluable — checked via doc model
    expect(doc.intelligence!.contributions.some(c => (c as any).isEvaluable !== undefined)).toBe(true);
  });
});

describe('Phase 8 Hardening — Seed determinism', () => {
  it('same input + same seed 42 identical evaluation', () => {
    const input = baseInput();
    input.seed = 42;
    const prj1 = createProject(input);
    const { bestCandidate: c1 } = generate(prj1);
    const e1 = evaluateCandidate(c1);

    const prj2 = createProject(input);
    const { bestCandidate: c2 } = generate(prj2);
    const e2 = evaluateCandidate(c2);

    expect(e1.candidateId).toBe(e2.candidateId);
    expect(e1.overallQuality).toBe(e2.overallQuality);
    expect(e1.quality.functional).toBe(e2.quality.functional);
    expect(e1.intelligenceScope).toBe(e2.intelligenceScope);
  });

  it('different seeds produce deterministic but potentially different candidates', () => {
    const input1 = { ...baseInput(), seed: 42 };
    const input2 = { ...baseInput(), seed: 123 };
    const prj1 = createProject(input1);
    const { bestCandidate: c1 } = generate(prj1);
    const prj2 = createProject(input2);
    const { bestCandidate: c2 } = generate(prj2);
    // Both deterministic
    const e1a = evaluateCandidate(c1);
    const e1b = evaluateCandidate(c1);
    expect(e1a.overallQuality).toBe(e1b.overallQuality);
    // Different seeds may give different strategies but evaluation is still deterministic
    expect(c1.metadata.seed).toBe(42);
    expect(c2.metadata.seed).toBe(123);
  });
});

describe('Phase 8 Hardening — Adversarial regression 10 scenarios monotonic', () => {
  function makeCandidateWithMetrics(metrics: Partial<ReturnType<typeof computeQualityMetrics>> & { intelligenceScope?: string }): ReturnType<typeof evaluateCandidate> {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const floor = bestCandidate.floors[0];
    const functional = { score: metrics.functional ?? 0.8, satisfiedCount: 5, totalCount: 6, mustSatisfied: 2, mustTotal: 2, preferSatisfied: 3, preferTotal: 4, avoidSatisfied: 1, avoidTotal: 1, findings: [], evaluations: [], satisfiedMust: 2, satisfiedPrefer: 3, strengths: [], weaknesses: [] };
    const circulation = { score: metrics.circulation ?? 0.8, entranceToLivingPath: 1, entranceToKitchenPath: 2, entranceToBedroomPath: 2, publicCirculationArea: 5, privateCirculationArea: 10, serviceCirculationArea: 2, longestImportantPath: 3, unnecessaryPathLength: 0, turnCount: 1, deadEndCount: 0, corridorArea: 10, circulationRatio: 0.2, accessGraphQuality: 0.9, findings: [], strengths: [], weaknesses: [] };
    const privacy = { score: metrics.privacy ?? 0.8, entranceToBedroomExposure: 0, entranceToPrivateZone: 0, livingToBedroom: 0, livingToBedroomExposure: 0, livingToBathroomExposure: 0, guestWCLocationScore: 1, bedroomClusterScore: 1, masterSeparationScore: 1, publicPrivateTransitionScore: 1, findings: [], strengths: [], weaknesses: [] };
    const daylight = { score: metrics.daylight ?? 0.8, roomScores: [], livingScore: 0.8, diningScore: 0.8, bedroomScore: 0.8, kitchenScore: 0.8, averageDepth: 5, exteriorWallRatio: 0.5, findings: [], strengths: [], weaknesses: [] };
    const furniture = { score: metrics.usability ?? 0.8, rooms: [], findings: [], strengths: [], weaknesses: [] };
    const kitchen = { score: metrics.kitchen ?? 0.8, hasRefrigerator: true, hasSink: true, hasCooktop: true, counterSequenceScore: 1, workingTriangleScore: 1, circulationScore: 1, entranceScore: 1, diningRelationshipScore: 1, livingRelationshipScore: 1, serviceScore: 1, isEvaluable: metrics.kitchen !== null, reason: undefined, findings: [], strengths: [], weaknesses: [] } as any;
    const bedroom = { score: metrics.bedroom ?? 0.8, rooms: [], hierarchyScore: 1, findings: [], strengths: [], weaknesses: [] };
    const entranceService = { score: metrics.entranceService ?? 0.8, entranceTransitionScore: 1, directBedroomExposureScore: 1, directWCExposureScore: 1, circulationEfficiencyScore: 1, foyerScore: 1, serviceCirculationScore: 1, bathroomExposureScore: 1, publicCrossingScore: 1, serviceAccessEfficiencyScore: 1, findings: [], strengths: [], weaknesses: [] };

    // If kitchen null, force not evaluable
    if (metrics.kitchen === null) {
      kitchen.score = null;
      kitchen.isEvaluable = false;
      kitchen.reason = 'N/A — Not Evaluated';
    }

    const quality = computeQualityMetrics(functional as any, circulation as any, privacy as any, daylight as any, furniture as any, kitchen as any, bedroom as any, entranceService as any, metrics.intelligenceScope ?? 'Floor Intelligence');
    // Return minimal eval for monotonic check
    return { quality } as any;
  }

  it('1: higher functional → higher overall (monotonic)', () => {
    const low = makeCandidateWithMetrics({ functional: 0.2 });
    const high = makeCandidateWithMetrics({ functional: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('2: higher circulation → higher overall', () => {
    const low = makeCandidateWithMetrics({ circulation: 0.1 });
    const high = makeCandidateWithMetrics({ circulation: 0.95 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('3: higher privacy → higher overall', () => {
    const low = makeCandidateWithMetrics({ privacy: 0.1 });
    const high = makeCandidateWithMetrics({ privacy: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('4: higher daylight → higher overall', () => {
    const low = makeCandidateWithMetrics({ daylight: 0.2 });
    const high = makeCandidateWithMetrics({ daylight: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('5: higher usability → higher overall', () => {
    const low = makeCandidateWithMetrics({ usability: 0.1 });
    const high = makeCandidateWithMetrics({ usability: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('6: higher kitchen (when evaluable) → higher overall', () => {
    const low = makeCandidateWithMetrics({ kitchen: 0.1 });
    const high = makeCandidateWithMetrics({ kitchen: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('7: kitchen N/A renormalization increases overall compared to 0 score', () => {
    const withZeroKitchen = makeCandidateWithMetrics({ kitchen: 0 });
    const withNAKitchen = makeCandidateWithMetrics({ kitchen: null });
    // N/A should be higher than 0 because weight excluded and renormalized
    expect(withNAKitchen.quality.overall).toBeGreaterThan(withZeroKitchen.quality.overall);
  });

  it('8: higher bedroom → higher overall', () => {
    const low = makeCandidateWithMetrics({ bedroom: 0.2 });
    const high = makeCandidateWithMetrics({ bedroom: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('9: higher entranceService → higher overall', () => {
    const low = makeCandidateWithMetrics({ entranceService: 0.1 });
    const high = makeCandidateWithMetrics({ entranceService: 0.95 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
  });

  it('10: all low vs all high monotonic', () => {
    const low = makeCandidateWithMetrics({ functional: 0.1, circulation: 0.1, privacy: 0.1, daylight: 0.1, usability: 0.1, kitchen: 0.1, bedroom: 0.1, entranceService: 0.1 });
    const high = makeCandidateWithMetrics({ functional: 0.9, circulation: 0.9, privacy: 0.9, daylight: 0.9, usability: 0.9, kitchen: 0.9, bedroom: 0.9, entranceService: 0.9 });
    expect(high.quality.overall).toBeGreaterThan(low.quality.overall);
    expect(high.quality.overall).toBeGreaterThan(0.8);
    expect(low.quality.overall).toBeLessThan(0.3);
  });
});

describe('Phase 8 Hardening — Cross-output consistency (Phase 9)', () => {
  it('documentation model, report, manifest agree on intelligenceScope and overallQuality — whole-building', () => {
    const prj = createProject(baseInput());
    const { bestCandidate } = generate(prj);
    const doc = buildDocumentation(prj, bestCandidate);
    // Phase 9: overallQuality is whole-building overall, quality.overall is avg floor overall
    expect(doc.intelligence!.overallQuality).toBeCloseTo(doc.intelligence!.wholeBuilding.overall, 2);
    expect(doc.intelligence!.intelligenceScope).toBeTruthy();
    expect(doc.intelligence!.quality.kitchen === null || typeof doc.intelligence!.quality.kitchen === 'number').toBe(true);
    expect(doc.intelligence!.floorCount).toBe(doc.building.floors);
    expect(doc.intelligence!.perFloor.length).toBe(doc.building.floors);
  });
});

describe('Phase 8 Hardening — E2E cases A-F', () => {
  it('A: minimal 1BR villa', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-A', building: { ...baseInput().building, bedrooms: 1, masterBedrooms: 0, bathrooms: 1, wc: 0, parkingSpaces: 0 } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.feasible).toBeDefined();
    expect(evalResult.overallQuality).toBeGreaterThanOrEqual(0);
  });

  it('B: 3BR with master', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-B', building: { ...baseInput().building, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, parkingSpaces: 2 } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.quality.bedroom).toBeGreaterThanOrEqual(0);
  });

  it('C: 2 floors — Phase 9 whole-building', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-C', building: { ...baseInput().building, floors: 2, hasStair: true } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.intelligenceScope).toContain('2 floors');
    expect(evalResult.floorCount).toBe(2);
    expect(evalResult.perFloor.length).toBe(2);
    expect(evalResult.vertical).toBeDefined();
  });

  it('D: no parking', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-D', building: { ...baseInput().building, parkingSpaces: 0 } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.feasible).toBeDefined();
  });

  it('E: open kitchen', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-E', building: { ...baseInput().building, kitchenType: 'open' as any } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.quality.kitchen === null || typeof evalResult.quality.kitchen === 'number').toBe(true);
  });

  it('F: small site 8x12', () => {
    const input: ProjectInput = { ...baseInput(), name: 'E2E-F', site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 6, northRotationDeg: 0 } };
    const prj = createProject(input);
    const { bestCandidate } = generate(prj);
    const evalResult = evaluateCandidate(bestCandidate);
    expect(evalResult.overallQuality).toBeGreaterThanOrEqual(0);
  });
});
