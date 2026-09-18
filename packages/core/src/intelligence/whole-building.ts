/**
 * Phase 9 — Whole-Building Intelligence
 *
 * Combines per-floor intelligence + vertical circulation + stacking + inter-floor into whole-building quality.
 * Preserves Q = Σ(Mi×Wi)/Σ(evaluable Wi) with N/A excluded renormalized.
 * No double-counting, explainable contributions.
 */

import type { FloorIntelligence, WholeBuildingQuality, QualityMetrics, ScoringContribution } from './types.js';
import type { VerticalCirculationEvaluation } from './types.js';
import type { StackingEvaluation } from './types.js';
import type { InterFloorEvaluation } from './types.js';
import { DEFAULT_WEIGHTS, WEIGHT_REASONS, normalizeScore } from './scoring.js';

export const WHOLE_BUILDING_WEIGHTS = {
  avgFloorQuality: 0.60,
  verticalCirculation: 0.20,
  stacking: 0.12,
  interFloor: 0.08,
};

export const WHOLE_BUILDING_WEIGHT_REASONS = {
  avgFloorQuality: 'Average of per-floor architectural quality — functional, circulation, privacy, daylight, usability, kitchen, bedroom, entranceService',
  verticalCirculation: 'Vertical circulation continuity, stair alignment, floor-to-floor connectivity, accessibility path — heuristic',
  stacking: 'Vertical stacking efficiency — kitchen over kitchen, bathroom over bathroom, wet-area clustering, circulation alignment — heuristic',
  interFloor: 'Inter-floor functional relationships — entrance→vertical→upper, public/private transition, bedroom/service distribution, privacy — heuristic',
};

function avgQualityMetrics(perFloor: FloorIntelligence[]): QualityMetrics {
  if (perFloor.length === 0) {
    return {
      functional: 0,
      circulation: 0,
      privacy: 0,
      daylight: 0,
      usability: 0,
      kitchen: null,
      bedroom: 0,
      entranceService: 0,
      overall: 0,
      intelligenceScope: 'Whole-Building Intelligence — 0 floors',
      evaluableWeightsSum: 0,
    };
  }

  const sum: Record<string, number> = {
    functional: 0,
    circulation: 0,
    privacy: 0,
    daylight: 0,
    usability: 0,
    bedroom: 0,
    entranceService: 0,
  };
  let kitchenSum = 0;
  let kitchenCount = 0;
  let overallSum = 0;
  let evaluableWeightsSumSum = 0;

  for (const pf of perFloor) {
    sum.functional += pf.quality.functional;
    sum.circulation += pf.quality.circulation;
    sum.privacy += pf.quality.privacy;
    sum.daylight += pf.quality.daylight;
    sum.usability += pf.quality.usability;
    sum.bedroom += pf.quality.bedroom;
    sum.entranceService += pf.quality.entranceService;
    overallSum += pf.quality.overall;
    evaluableWeightsSumSum += pf.quality.evaluableWeightsSum;
    if (pf.quality.kitchen !== null) {
      kitchenSum += pf.quality.kitchen;
      kitchenCount++;
    }
  }

  const count = perFloor.length;
  const avgKitchen = kitchenCount > 0 ? kitchenSum / kitchenCount : null;
  const avgOverall = overallSum / count;
  const avgEvaluableWeightsSum = evaluableWeightsSumSum / count;

  // For avgQuality, we need to compute overall as weighted sum of avg metrics, with N/A handling
  // Use same logic as computeQualityMetrics but with averaged metrics
  const kitchenEvaluable = avgKitchen !== null;
  let evaluableWeightsSum = 0;
  let weightedSum = 0;
  const add = (score: number | null, weight: number, evaluable: boolean) => {
    if (evaluable && score !== null) {
      evaluableWeightsSum += weight;
      weightedSum += score * weight;
    }
  };
  add(sum.functional / count, DEFAULT_WEIGHTS.functional, true);
  add(sum.circulation / count, DEFAULT_WEIGHTS.circulation, true);
  add(sum.privacy / count, DEFAULT_WEIGHTS.privacy, true);
  add(sum.daylight / count, DEFAULT_WEIGHTS.daylight, true);
  add(sum.usability / count, DEFAULT_WEIGHTS.usability, true);
  add(avgKitchen, DEFAULT_WEIGHTS.kitchen, kitchenEvaluable);
  add(sum.bedroom / count, DEFAULT_WEIGHTS.bedroom, true);
  add(sum.entranceService / count, DEFAULT_WEIGHTS.entranceService, true);

  const renormalizedOverall = evaluableWeightsSum > 0 ? weightedSum / evaluableWeightsSum : 0;

  return {
    functional: normalizeScore(sum.functional / count),
    circulation: normalizeScore(sum.circulation / count),
    privacy: normalizeScore(sum.privacy / count),
    daylight: normalizeScore(sum.daylight / count),
    usability: normalizeScore(sum.usability / count),
    kitchen: avgKitchen !== null ? normalizeScore(avgKitchen) : null,
    bedroom: normalizeScore(sum.bedroom / count),
    entranceService: normalizeScore(sum.entranceService / count),
    overall: normalizeScore(renormalizedOverall),
    intelligenceScope: `Whole-Building Intelligence — ${count} floors, avg floor quality`,
    evaluableWeightsSum,
  };
}

export function computeWholeBuildingQuality(
  perFloor: FloorIntelligence[],
  vertical: VerticalCirculationEvaluation,
  stacking: StackingEvaluation,
  interFloor: InterFloorEvaluation
): WholeBuildingQuality {
  const floorCount = perFloor.length;
  const avgFloorQuality = avgQualityMetrics(perFloor);

  // Weighted combination
  const overall = Math.max(0, Math.min(1,
    avgFloorQuality.overall * WHOLE_BUILDING_WEIGHTS.avgFloorQuality +
    vertical.score * WHOLE_BUILDING_WEIGHTS.verticalCirculation +
    stacking.score * WHOLE_BUILDING_WEIGHTS.stacking +
    interFloor.score * WHOLE_BUILDING_WEIGHTS.interFloor
  ));

  // Build contributions for whole-building: avoid double-counting by using averaged per-floor metrics weighted by avgFloorQuality weight
  const contributions: ScoringContribution[] = [];

  // Per-floor averaged metrics contributions (weight = DEFAULT_WEIGHT * avgFloorQuality weight)
  const avgMetrics = [
    { key: 'functional', score: avgFloorQuality.functional, reason: WEIGHT_REASONS.functional + ' — averaged across floors' },
    { key: 'circulation', score: avgFloorQuality.circulation, reason: WEIGHT_REASONS.circulation + ' — averaged across floors' },
    { key: 'privacy', score: avgFloorQuality.privacy, reason: WEIGHT_REASONS.privacy + ' — averaged across floors' },
    { key: 'daylight', score: avgFloorQuality.daylight, reason: WEIGHT_REASONS.daylight + ' — averaged across floors' },
    { key: 'usability', score: avgFloorQuality.usability, reason: WEIGHT_REASONS.usability + ' — averaged across floors' },
    { key: 'kitchen', score: avgFloorQuality.kitchen, reason: WEIGHT_REASONS.kitchen + ' — averaged across floors, N/A if no kitchen on any floor' },
    { key: 'bedroom', score: avgFloorQuality.bedroom, reason: WEIGHT_REASONS.bedroom + ' — averaged across floors' },
    { key: 'entranceService', score: avgFloorQuality.entranceService, reason: WEIGHT_REASONS.entranceService + ' — averaged across floors' },
  ];

  for (const m of avgMetrics) {
    const isEvaluable = m.score !== null && m.score !== undefined;
    const baseWeight = (DEFAULT_WEIGHTS as any)[m.key === 'usability' ? 'usability' : m.key] ?? 0;
    const weight = isEvaluable ? baseWeight * WHOLE_BUILDING_WEIGHTS.avgFloorQuality : 0;
    const normalized = isEvaluable ? normalizeScore(m.score as number) : 0;
    const weightedScore = isEvaluable ? (m.score as number) * weight : 0;
    let reason = m.reason;
    if (!isEvaluable) reason = `${m.reason} — N/A — Not Evaluated`;
    contributions.push({
      metric: m.key,
      raw: isEvaluable ? (m.score as number) : null,
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

  // Vertical, stacking, interFloor contributions — avgFloorQuality is implicit via per-metric breakdown weighted by 0.6, no double-count
  // (avgFloorQuality overall is available as wholeBuilding.avgFloorQuality.overall, not as separate contribution to avoid double-count)
  contributions.push({
    metric: 'verticalCirculation',
    raw: vertical.score,
    normalized: normalizeScore(vertical.score),
    weight: WHOLE_BUILDING_WEIGHTS.verticalCirculation,
    weightedScore: vertical.score * WHOLE_BUILDING_WEIGHTS.verticalCirculation,
    range: [0, 1],
    reason: WHOLE_BUILDING_WEIGHT_REASONS.verticalCirculation,
    isHard: false,
    isHeuristic: true,
    isEvaluable: true,
  });
  contributions.push({
    metric: 'stacking',
    raw: stacking.score,
    normalized: normalizeScore(stacking.score),
    weight: WHOLE_BUILDING_WEIGHTS.stacking,
    weightedScore: stacking.score * WHOLE_BUILDING_WEIGHTS.stacking,
    range: [0, 1],
    reason: WHOLE_BUILDING_WEIGHT_REASONS.stacking,
    isHard: false,
    isHeuristic: true,
    isEvaluable: true,
  });
  contributions.push({
    metric: 'interFloor',
    raw: interFloor.score,
    normalized: normalizeScore(interFloor.score),
    weight: WHOLE_BUILDING_WEIGHTS.interFloor,
    weightedScore: interFloor.score * WHOLE_BUILDING_WEIGHTS.interFloor,
    range: [0, 1],
    reason: WHOLE_BUILDING_WEIGHT_REASONS.interFloor,
    isHard: false,
    isHeuristic: true,
    isEvaluable: true,
  });

  // Overall
  contributions.push({
    metric: 'overall',
    raw: overall,
    normalized: overall,
    weight: 1,
    weightedScore: overall,
    range: [0, 1],
    reason: `Whole-building quality = avgFloorQuality(${(avgFloorQuality.overall * 100).toFixed(0)}%)*${WHOLE_BUILDING_WEIGHTS.avgFloorQuality} + vertical(${(vertical.score * 100).toFixed(0)}%)*${WHOLE_BUILDING_WEIGHTS.verticalCirculation} + stacking(${(stacking.score * 100).toFixed(0)}%)*${WHOLE_BUILDING_WEIGHTS.stacking} + interFloor(${(interFloor.score * 100).toFixed(0)}%)*${WHOLE_BUILDING_WEIGHTS.interFloor} — Whole-Building Intelligence — ${floorCount} floors`,
    isHard: false,
    isHeuristic: true,
    isEvaluable: true,
  });

  // Aggregate strengths/weaknesses
  const allStrengths = [
    ...perFloor.flatMap(pf => pf.strengths.map(s => `[F${pf.floorLevel}] ${s}`)),
    ...vertical.strengths.map(s => `[Vertical] ${s}`),
    ...stacking.strengths.map(s => `[Stacking] ${s}`),
    ...interFloor.strengths.map(s => `[InterFloor] ${s}`),
  ];
  const allWeaknesses = [
    ...perFloor.flatMap(pf => pf.weaknesses.map(w => `[F${pf.floorLevel}] ${w}`)),
    ...vertical.weaknesses.map(w => `[Vertical] ${w}`),
    ...stacking.weaknesses.map(w => `[Stacking] ${w}`),
    ...interFloor.weaknesses.map(w => `[InterFloor] ${w}`),
  ];

  const uniq = (arr: string[]) => Array.from(new Set(arr));
  const strengths = uniq(allStrengths).slice(0, 10);
  const weaknesses = uniq(allWeaknesses).slice(0, 10);

  const topFloor = [...perFloor].sort((a, b) => b.overallQuality - a.overallQuality)[0];
  const bottomFloor = [...perFloor].sort((a, b) => a.overallQuality - b.overallQuality)[0];
  const tradeOff = `Whole-building ${floorCount} floors: best floor F${topFloor?.floorLevel} ${(topFloor ? (topFloor.overallQuality * 100).toFixed(0) : 'N/A')}%, worst floor F${bottomFloor?.floorLevel} ${(bottomFloor ? (bottomFloor.overallQuality * 100).toFixed(0) : 'N/A')}%, avg ${(avgFloorQuality.overall * 100).toFixed(0)}%, vertical ${(vertical.score * 100).toFixed(0)}%, stacking ${(stacking.score * 100).toFixed(0)}%, interFloor ${(interFloor.score * 100).toFixed(0)}%, overall ${(overall * 100).toFixed(0)}%. Scope: Whole-Building Intelligence — ${floorCount} floors.`;

  return {
    floorCount,
    perFloor,
    avgFloorQuality,
    vertical,
    stacking,
    interFloor,
    overall,
    contributions: contributions.sort((a, b) => b.weight - a.weight),
    strengths,
    weaknesses,
    tradeOff,
    intelligenceScope: `Whole-Building Intelligence — ${floorCount} floors`,
    evaluableWeightsSum: contributions.filter(c => c.metric !== 'overall' && c.isEvaluable).reduce((sum, c) => sum + c.weight, 0),
  };
}
