/**
 * Phase 8 - Trade-off / Candidate Comparison
 *
 * Structured comparison between candidates: feasibility, major metrics, differences, strengths, weaknesses, reasons.
 */

import type { CandidateEvaluation, CandidateComparison, OptimizationResult } from './types.js';

export function compareCandidates(a: CandidateEvaluation, b: CandidateEvaluation): CandidateComparison {
  const feasibilityDiff = a.feasible === b.feasible
    ? `Both ${a.feasible ? 'feasible' : 'not feasible'} (hard violations A:${a.hardViolations} B:${b.hardViolations}) — Whole-building ${a.floorCount} floors`
    : `Feasibility differs: A ${a.feasible ? 'feasible' : `not feasible (${a.hardViolations} hard)`} vs B ${b.feasible ? 'feasible' : `not feasible (${b.hardViolations} hard)`} — Whole-building`;

  const metrics = ['functional', 'circulation', 'privacy', 'daylight', 'usability', 'kitchen', 'bedroom', 'entranceService', 'overall'] as const;

  const metricDiffs = metrics.map(m => {
    const av = (a.quality as any)[m];
    const bv = (b.quality as any)[m];
    // Handle N/A
    if (av === null || bv === null) {
      return { metric: m, a: av ?? 0, b: bv ?? 0, diff: 0, interpretation: av === null && bv === null ? 'both N/A' : av === null ? 'A N/A' : 'B N/A' };
    }
    const diff = av - bv;
    let interpretation = '';
    if (Math.abs(diff) < 0.05) interpretation = 'similar';
    else if (diff > 0) interpretation = `A better by ${(diff * 100).toFixed(0)}%`;
    else interpretation = `B better by ${(Math.abs(diff) * 100).toFixed(0)}%`;
    return { metric: m, a: av, b: bv, diff, interpretation };
  });

  // Add whole-building specific diffs: vertical, stacking, interFloor, per-floor avg, overall — push as any to allow extended metric names
  const wholeMetrics = [
    { metric: 'wholeBuildingOverall', a: a.wholeBuilding?.overall ?? a.overallQuality, b: b.wholeBuilding?.overall ?? b.overallQuality },
    { metric: 'verticalCirculation', a: a.vertical?.score ?? 0, b: b.vertical?.score ?? 0 },
    { metric: 'stacking', a: a.stacking?.score ?? 0, b: b.stacking?.score ?? 0 },
    { metric: 'interFloor', a: a.interFloor?.score ?? 0, b: b.interFloor?.score ?? 0 },
    { metric: 'avgFloorQuality', a: a.wholeBuilding?.avgFloorQuality?.overall ?? a.quality.overall, b: b.wholeBuilding?.avgFloorQuality?.overall ?? b.quality.overall },
  ];
  for (const wm of wholeMetrics) {
    const diff = wm.a - wm.b;
    let interpretation = '';
    if (Math.abs(diff) < 0.05) interpretation = 'similar';
    else if (diff > 0) interpretation = `A better by ${(diff * 100).toFixed(0)}%`;
    else interpretation = `B better by ${(Math.abs(diff) * 100).toFixed(0)}%`;
    (metricDiffs as any[]).push({ metric: wm.metric, a: wm.a, b: wm.b, diff, interpretation });
  }

  // Per-floor diffs — use any to allow dynamic floor metric names
  if (a.perFloor && b.perFloor) {
    const maxFloors = Math.min(a.perFloor.length, b.perFloor.length);
    for (let i = 0; i < maxFloors; i++) {
      const av = a.perFloor[i].overallQuality;
      const bv = b.perFloor[i].overallQuality;
      const diff = av - bv;
      let interpretation = '';
      if (Math.abs(diff) < 0.05) interpretation = 'similar';
      else if (diff > 0) interpretation = `A better by ${(diff * 100).toFixed(0)}%`;
      else interpretation = `B better by ${(Math.abs(diff) * 100).toFixed(0)}%`;
      (metricDiffs as any[]).push({ metric: `floor${i}Quality`, a: av, b: bv, diff, interpretation });
    }
  }

  const tradeOffExplanation = (() => {
    const filterEvaluable = (q: any) => Object.entries(q).filter(([k, v]) => v !== null && k !== 'intelligenceScope' && k !== 'evaluableWeightsSum').sort((x, y) => (y[1] as number) - (x[1] as number));
    const aTop = filterEvaluable(a.quality).slice(0, 2).map(x => x[0]).join(', ');
    const bTop = filterEvaluable(b.quality).slice(0, 2).map(x => x[0]).join(', ');
    const scopeNote = `Scope: ${a.intelligenceScope}. Hard validation: All ${a.floorCount} floors. Vertical: A ${(a.vertical?.score ?? 0 * 100).toFixed(0)}% vs B ${(b.vertical?.score ?? 0 * 100).toFixed(0)}%, Stacking: A ${(a.stacking?.score ?? 0 * 100).toFixed(0)}% vs B ${(b.stacking?.score ?? 0 * 100).toFixed(0)}%, InterFloor: A ${(a.interFloor?.score ?? 0 * 100).toFixed(0)}% vs B ${(b.interFloor?.score ?? 0 * 100).toFixed(0)}%`;
    return `Candidate ${a.candidateId} (${a.strategy}) strengths: ${aTop}. Candidate ${b.candidateId} (${b.strategy}) strengths: ${bTop}. Trade-off: A whole-building ${(a.overallQuality * 100).toFixed(0)}% vs B ${(b.overallQuality * 100).toFixed(0)}%. ${a.tradeOff} vs ${b.tradeOff} ${scopeNote}`;
  })();

  return {
    candidateA: a.candidateId,
    candidateB: b.candidateId,
    feasibilityDiff,
    metricDiffs,
    strengthsA: a.strengths,
    weaknessesA: a.weaknesses,
    strengthsB: b.strengths,
    weaknessesB: b.weaknesses,
    tradeOffExplanation,
  };
}

export function buildOptimizationResult(evaluations: CandidateEvaluation[]): OptimizationResult {
  const sorted = [...evaluations].sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.hardViolations !== b.hardViolations) return a.hardViolations - b.hardViolations;
    // Whole-building ranking: overallQuality is whole-building overall
    return b.overallQuality - a.overallQuality;
  });

  const best = sorted[0];
  const alternatives = sorted.slice(1, 4);

  // Diverse top: pick candidates with different top strengths — now whole-building aware
  const diverseTop: OptimizationResult['diverseTop'] = [];
  const usedStrategies = new Set<string>();

  // Label by actual behavior — whole-building
  for (const ev of sorted) {
    if (diverseTop.length >= 3) break;
    if (usedStrategies.has(ev.strategy)) continue;
    let label = '';
    let reason = '';
    const q = ev.quality; // avg floor quality for backward compat
    const wb = ev.wholeBuilding;
    const vert = ev.vertical?.score ?? 0;
    const stack = ev.stacking?.score ?? 0;
    const inter = ev.interFloor?.score ?? 0;

    if (wb && vert >= 0.85 && stack >= 0.8) {
      label = 'Vertical / stacking efficient';
      reason = `Vertical ${(vert * 100).toFixed(0)}%, stacking ${(stack * 100).toFixed(0)}%, whole-building ${(wb.overall * 100).toFixed(0)}% — efficient vertical organization`;
    } else if (q.functional >= 0.8 && q.circulation >= 0.7) {
      label = 'Area / efficiency oriented';
      reason = `Functional ${(q.functional * 100).toFixed(0)}%, circulation ${(q.circulation * 100).toFixed(0)}% — efficient layout, whole-building ${(wb ? (wb.overall * 100).toFixed(0) : (ev.overallQuality * 100).toFixed(0))}%`;
    } else if (q.privacy >= 0.85) {
      label = 'Privacy oriented';
      reason = `Privacy ${(q.privacy * 100).toFixed(0)}% — strong public/private separation, whole-building ${(wb ? (wb.overall * 100).toFixed(0) : (ev.overallQuality * 100).toFixed(0))}%`;
    } else if (q.daylight >= 0.8) {
      label = 'Daylight / orientation oriented';
      reason = `Daylight ${(q.daylight * 100).toFixed(0)}% — good orientation and exterior walls, whole-building ${(wb ? (wb.overall * 100).toFixed(0) : (ev.overallQuality * 100).toFixed(0))}%`;
    } else if (q.usability >= 0.85) {
      label = 'Usability oriented';
      reason = `Usability ${(q.usability * 100).toFixed(0)}% — furniture and clearance good, whole-building ${(wb ? (wb.overall * 100).toFixed(0) : (ev.overallQuality * 100).toFixed(0))}%`;
    } else if (wb && wb.vertical && wb.vertical.score < 0.5) {
      label = 'Vertical circulation weak';
      reason = `Vertical ${(vert * 100).toFixed(0)}% — weak vertical circulation, whole-building ${(wb.overall * 100).toFixed(0)}%`;
    } else {
      label = `${ev.strategy} oriented — ${ev.floorCount}F whole-building`;
      reason = `Overall ${(wb ? (wb.overall * 100).toFixed(0) : (ev.overallQuality * 100).toFixed(0))}% — balanced whole-building ${ev.floorCount} floors, vertical ${(vert * 100).toFixed(0)}%, stacking ${(stack * 100).toFixed(0)}%, interFloor ${(inter * 100).toFixed(0)}%`;
    }
    diverseTop.push({ label, candidate: ev, reason });
    usedStrategies.add(ev.strategy);
  }

  const comparisons: CandidateComparison[] = [];
  for (let i = 0; i < Math.min(sorted.length, 3); i++) {
    for (let j = i + 1; j < Math.min(sorted.length, 3); j++) {
      comparisons.push(compareCandidates(sorted[i], sorted[j]));
    }
  }

  return {
    candidates: sorted,
    best,
    alternatives,
    comparisons,
    diverseTop,
  };
}
