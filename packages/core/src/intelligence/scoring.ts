/**
 * Phase 8 - Scoring System
 *
 * Transparent scoring model separating hard feasibility vs architectural quality.
 * Deterministic normalization, inspectable contributions, documented weights.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { QualityMetrics, ScoringContribution, CandidateEvaluation } from './types.js';
import type { FunctionalEvaluation } from './types.js';
import type { CirculationEvaluation } from './types.js';
import type { PrivacyEvaluation } from './types.js';
import type { DaylightEvaluation } from './types.js';
import type { FurnitureEvaluation } from './types.js';
import type { KitchenEvaluation } from './types.js';
import type { BedroomEvaluation } from './types.js';
import type { EntranceServiceEvaluation } from './types.js';

export interface ScoringWeights {
  functional: number;
  circulation: number;
  privacy: number;
  daylight: number;
  usability: number;
  kitchen: number;
  bedroom: number;
  entranceService: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  functional: 0.20, // adjacency MUST/PREFER/AVOID
  circulation: 0.20, // path efficiency, dead ends, ratio
  privacy: 0.15, // public/private separation
  daylight: 0.15, // orientation, exterior wall, depth
  usability: 0.10, // furniture usability
  kitchen: 0.08, // kitchen working zone
  bedroom: 0.07, // bedroom usability hierarchy
  entranceService: 0.05, // entrance transition & service
};

export const WEIGHT_REASONS: Record<keyof ScoringWeights, string> = {
  functional: 'Functional adjacency strongly affects daily use; MUST relationships are hard, PREFER weighted',
  circulation: 'Circulation efficiency impacts usable area and comfort; excessive ratio and dead ends penalized',
  privacy: 'Privacy is core to residential quality; entrance->bedroom and living->bathroom exposure critical',
  daylight: 'Daylight and orientation affect livability; living and bedrooms prioritized',
  usability: 'Furniture usability ensures rooms are not just geometric but functional',
  kitchen: 'Kitchen working zone and dining relationship affect service efficiency',
  bedroom: 'Bedroom usability, wardrobe, window, privacy, master hierarchy',
  entranceService: 'Entrance transition and service crossing affect first impression and functionality',
};

export function normalizeScore(raw: number): number {
  return Math.max(0, Math.min(1, raw));
}

export function computeQualityMetrics(
  functional: FunctionalEvaluation,
  circulation: CirculationEvaluation,
  privacy: PrivacyEvaluation,
  daylight: DaylightEvaluation,
  furniture: FurnitureEvaluation,
  kitchen: KitchenEvaluation,
  bedroom: BedroomEvaluation,
  entranceService: EntranceServiceEvaluation,
  intelligenceScope: string = 'Floor Intelligence'
): QualityMetrics {
  // Handle NOT EVALUABLE kitchen: exclude from weighted sum and renormalize
  const kitchenEvaluable = kitchen.isEvaluable && kitchen.score !== null;
  const kitchenScore = kitchenEvaluable ? kitchen.score! : null;

  // Compute sum of evaluable weights
  let evaluableWeightsSum = 0;
  let weightedSum = 0;

  const addMetric = (score: number | null, weight: number, evaluable: boolean) => {
    if (evaluable && score !== null) {
      evaluableWeightsSum += weight;
      weightedSum += score * weight;
    }
  };

  addMetric(functional.score, DEFAULT_WEIGHTS.functional, true);
  addMetric(circulation.score, DEFAULT_WEIGHTS.circulation, true);
  addMetric(privacy.score, DEFAULT_WEIGHTS.privacy, true);
  addMetric(daylight.score, DEFAULT_WEIGHTS.daylight, true);
  addMetric(furniture.score, DEFAULT_WEIGHTS.usability, true);
  addMetric(kitchenScore, DEFAULT_WEIGHTS.kitchen, kitchenEvaluable);
  addMetric(bedroom.score, DEFAULT_WEIGHTS.bedroom, true);
  addMetric(entranceService.score, DEFAULT_WEIGHTS.entranceService, true);

  // Renormalize: Q = Σ(evaluable metric × weight) / Σ(evaluable weights)
  // If all evaluable, evaluableWeightsSum = 1.0, Q = weightedSum
  // If kitchen N/A, sum = 0.92, Q = weightedSum / 0.92
  const overall = evaluableWeightsSum > 0 ? weightedSum / evaluableWeightsSum : 0;

  // Phase 9.1 — Single authoritative scope representation.
  // Valid scopes: Floor N Intelligence, Whole-Building Intelligence — N floors.
  // Caller must provide explicit scope; default is generic Floor Intelligence for backward compat.
  // Legacy "Ground Floor Intelligence — ... not evaluated" path removed entirely.

  return {
    functional: normalizeScore(functional.score),
    circulation: normalizeScore(circulation.score),
    privacy: normalizeScore(privacy.score),
    daylight: normalizeScore(daylight.score),
    usability: normalizeScore(furniture.score),
    kitchen: kitchenScore !== null ? normalizeScore(kitchenScore) : null,
    bedroom: normalizeScore(bedroom.score),
    entranceService: normalizeScore(entranceService.score),
    overall: normalizeScore(overall),
    intelligenceScope,
    evaluableWeightsSum,
  };
}

export function buildContributions(quality: QualityMetrics): ScoringContribution[] {
  const contributions: ScoringContribution[] = [];
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof ScoringWeights>) {
    const metricName = key === 'usability' ? 'usability' : key;
    const raw = (quality as any)[metricName] ?? null;
    const isEvaluable = raw !== null && raw !== undefined;
    const weight = isEvaluable ? DEFAULT_WEIGHTS[key] : 0;
    const normalized = isEvaluable ? normalizeScore(raw as number) : 0;
    const weightedScore = isEvaluable ? (raw as number) * weight : 0;
    let reason = WEIGHT_REASONS[key];
    if (!isEvaluable) {
      if (metricName === 'kitchen') {
        reason = 'N/A — Not Evaluated — insufficient geometry for kitchen evaluation';
      } else {
        reason = WEIGHT_REASONS[key] + ' — N/A';
      }
    }
    contributions.push({
      metric: metricName as any,
      raw: isEvaluable ? (raw as number) : null,
      normalized,
      weight,
      weightedScore,
      range: [0, 1],
      reason,
      isHard: false,
      isHeuristic: true,
      isEvaluable,
    });
  }
  // Overall — weight 1, but reason includes renormalization info
  const overallReason = quality.evaluableWeightsSum < 1
    ? `Weighted sum renormalized: Σ(evaluable metric × weight) / Σ(evaluable weights) = Σ / ${quality.evaluableWeightsSum.toFixed(3)} — ${quality.intelligenceScope}`
    : `Weighted sum of all quality metrics — ${quality.intelligenceScope}`;
  contributions.push({
    metric: 'overall',
    raw: quality.overall,
    normalized: quality.overall,
    weight: 1,
    weightedScore: quality.overall,
    range: [0, 1],
    reason: overallReason,
    isHard: false,
    isHeuristic: true,
    isEvaluable: true,
  });
  return contributions.sort((a, b) => b.weight - a.weight);
}

export function isFeasible(candidate: LayoutCandidate): { feasible: boolean; hardViolations: number; hardFindings: any[] } {
  const hard = candidate.findings.filter(f => f.severity === 'hard');
  // Also check GEO outside, etc. already in findings
  const feasible = hard.length === 0;
  return { feasible, hardViolations: hard.length, hardFindings: hard };
}
