/**
 * Phase 9 — Vertical Stacking Intelligence
 *
 * Deterministic stacking analysis: kitchen over kitchen, bathroom over bathroom, wet-area clustering, circulation alignment, service zones.
 * Rewards, penalties, findings, explanations. Architectural optimization heuristic, not legal rule.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { StackingEvaluation } from './types.js';
import { rOverlapArea } from '../geometry/rect.js';

type WetType = 'kitchen' | 'bathroom' | 'master-bathroom' | 'guest-wc' | 'utility' | 'storage';

const WET_TYPES: WetType[] = ['kitchen', 'bathroom', 'master-bathroom', 'guest-wc', 'utility', 'storage'];
const KITCHEN_TYPES = new Set(['kitchen']);
const BATHROOM_TYPES = new Set(['bathroom', 'master-bathroom', 'guest-wc']);
const CIRC_TYPES = new Set(['corridor', 'stair-hall', 'foyer', 'entrance']);
const SERVICE_TYPES = new Set(['storage', 'utility']);

function isWet(type: string): boolean {
  return WET_TYPES.includes(type as WetType);
}

function isKitchen(type: string): boolean {
  return KITCHEN_TYPES.has(type);
}

function isBathroom(type: string): boolean {
  return BATHROOM_TYPES.has(type);
}

function isCirc(type: string): boolean {
  return CIRC_TYPES.has(type);
}

function isService(type: string): boolean {
  return SERVICE_TYPES.has(type);
}

function overlapRatio(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const overlap = rOverlapArea(a, b);
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 ? overlap / minArea : 0;
}

export function evaluateStacking(candidate: LayoutCandidate): StackingEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const details: StackingEvaluation['details'] = [];

  const floors = [...candidate.floors].sort((a, b) => a.level - b.level);
  const floorCount = floors.length;

  if (floorCount <= 1) {
    return {
      score: 1,
      kitchenStackingScore: 1,
      bathroomStackingScore: 1,
      wetAreaClusteringScore: 1,
      circulationAlignmentScore: 1,
      serviceZoneAlignmentScore: 1,
      details: [],
      findings: [],
      strengths: ['+ single floor — stacking not applicable'],
      weaknesses: [],
      isHeuristic: true,
    };
  }

  let kitchenAligned = 0, kitchenTotal = 0, kitchenOverlapSum = 0;
  let bathroomAligned = 0, bathroomTotal = 0, bathroomOverlapSum = 0;
  let wetAligned = 0, wetTotal = 0, wetOverlapSum = 0;
  let circAligned = 0, circTotal = 0, circOverlapSum = 0;
  let serviceAligned = 0, serviceTotal = 0, serviceOverlapSum = 0;

  for (let i = 0; i < floors.length - 1; i++) {
    const lower = floors[i];
    const upper = floors[i + 1];

    // Kitchen over kitchen
    const lowerKitchens = lower.spaces.filter(s => isKitchen(s.type));
    const upperKitchens = upper.spaces.filter(s => isKitchen(s.type));
    for (const lk of lowerKitchens) {
      for (const uk of upperKitchens) {
        kitchenTotal++;
        const ov = overlapRatio(lk.rect, uk.rect);
        kitchenOverlapSum += ov;
        const aligned = ov >= 0.3;
        if (aligned) kitchenAligned++;
        details.push({
          fromLevel: lower.level,
          toLevel: upper.level,
          fromType: lk.type,
          toType: uk.type,
          overlap: ov,
          aligned,
          reason: `Kitchen ${lower.level}→${upper.level} overlap ${(ov * 100).toFixed(0)}% ${aligned ? 'aligned' : 'displaced'} — wet stacking heuristic`,
        });
        if (aligned) strengths.push(`+ kitchen stacking ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
        else weaknesses.push(`- kitchen displaced ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
      }
    }

    // Bathroom over bathroom
    const lowerBaths = lower.spaces.filter(s => isBathroom(s.type));
    const upperBaths = upper.spaces.filter(s => isBathroom(s.type));
    for (const lb of lowerBaths) {
      for (const ub of upperBaths) {
        bathroomTotal++;
        const ov = overlapRatio(lb.rect, ub.rect);
        bathroomOverlapSum += ov;
        const aligned = ov >= 0.2;
        if (aligned) bathroomAligned++;
        details.push({
          fromLevel: lower.level,
          toLevel: upper.level,
          fromType: lb.type,
          toType: ub.type,
          overlap: ov,
          aligned,
          reason: `Bathroom ${lower.level}→${upper.level} overlap ${(ov * 100).toFixed(0)}% ${aligned ? 'aligned' : 'displaced'}`,
        });
        if (aligned) strengths.push(`+ bathroom stacking ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
        else weaknesses.push(`- bathroom displaced ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
      }
    }

    // Wet over wet (any wet over any wet)
    const lowerWets = lower.spaces.filter(s => isWet(s.type));
    const upperWets = upper.spaces.filter(s => isWet(s.type));
    for (const lw of lowerWets) {
      for (const uw of upperWets) {
        wetTotal++;
        const ov = overlapRatio(lw.rect, uw.rect);
        wetOverlapSum += ov;
        const aligned = ov >= 0.15;
        if (aligned) wetAligned++;
        // Only add detail if not already kitchen/bathroom detail? Add anyway but avoid duplication
        if (!isKitchen(lw.type) || !isKitchen(uw.type)) {
          if (!isBathroom(lw.type) || !isBathroom(uw.type)) {
            details.push({
              fromLevel: lower.level,
              toLevel: upper.level,
              fromType: lw.type,
              toType: uw.type,
              overlap: ov,
              aligned,
              reason: `Wet-area ${lw.type}→${uw.type} ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`,
            });
          }
        }
      }
    }

    // Circulation alignment
    const lowerCirc = lower.spaces.filter(s => isCirc(s.type));
    const upperCirc = upper.spaces.filter(s => isCirc(s.type));
    for (const lc of lowerCirc) {
      for (const uc of upperCirc) {
        circTotal++;
        const ov = overlapRatio(lc.rect, uc.rect);
        circOverlapSum += ov;
        const aligned = ov >= 0.25;
        if (aligned) circAligned++;
        details.push({
          fromLevel: lower.level,
          toLevel: upper.level,
          fromType: lc.type,
          toType: uc.type,
          overlap: ov,
          aligned,
          reason: `Circulation ${lc.type}→${uc.type} ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`,
        });
        if (aligned) strengths.push(`+ circulation alignment ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
        else weaknesses.push(`- circulation displaced ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`);
      }
    }

    // Service zone alignment
    const lowerService = lower.spaces.filter(s => isService(s.type));
    const upperService = upper.spaces.filter(s => isService(s.type));
    for (const ls of lowerService) {
      for (const us of upperService) {
        serviceTotal++;
        const ov = overlapRatio(ls.rect, us.rect);
        serviceOverlapSum += ov;
        const aligned = ov >= 0.2;
        if (aligned) serviceAligned++;
        details.push({
          fromLevel: lower.level,
          toLevel: upper.level,
          fromType: ls.type,
          toType: us.type,
          overlap: ov,
          aligned,
          reason: `Service ${ls.type}→${us.type} ${lower.level}→${upper.level} ${(ov * 100).toFixed(0)}%`,
        });
      }
    }
  }

  const kitchenStackingScore = kitchenTotal > 0 ? kitchenAligned / kitchenTotal : 1;
  const bathroomStackingScore = bathroomTotal > 0 ? bathroomAligned / bathroomTotal : 1;
  const wetAreaClusteringScore = wetTotal > 0 ? wetAligned / wetTotal : 1;
  const circulationAlignmentScore = circTotal > 0 ? circAligned / circTotal : 1;
  const serviceZoneAlignmentScore = serviceTotal > 0 ? serviceAligned / serviceTotal : 1;

  // Overall stacking score weighted
  const score = Math.max(0, Math.min(1,
    kitchenStackingScore * 0.25 +
    bathroomStackingScore * 0.25 +
    wetAreaClusteringScore * 0.20 +
    circulationAlignmentScore * 0.20 +
    serviceZoneAlignmentScore * 0.10
  ));

  if (score >= 0.8) strengths.push(`+ efficient vertical stacking ${(score * 100).toFixed(0)}% — wet areas clustered, circulation aligned (HEURISTIC)`);
  else if (score < 0.5) {
    weaknesses.push(`- inefficient stacking ${(score * 100).toFixed(0)}% — wet areas displaced, circulation misaligned (HEURISTIC)`);
    findings.push({
      code: 'STACKING_INEFFICIENT',
      severity: 'advisory',
      message: `Vertical stacking inefficient ${(score * 100).toFixed(0)}% — kitchen ${kitchenStackingScore.toFixed(2)}, bathroom ${bathroomStackingScore.toFixed(2)}, wet ${wetAreaClusteringScore.toFixed(2)}, circ ${circulationAlignmentScore.toFixed(2)} (HEURISTIC)`,
      entityIds: [],
    } as Finding);
  }

  // Phase 9.1 — Do not arbitrarily truncate for large N, but keep bounded deterministically
  // Max details: up to 100 for explainability, sorted deterministically by fromLevel, toLevel, fromType, toType
  const sortedDetails = [...details].sort((a, b) => a.fromLevel - b.fromLevel || a.toLevel - b.toLevel || a.fromType.localeCompare(b.fromType) || a.toType.localeCompare(b.toType));
  return {
    score,
    kitchenStackingScore,
    bathroomStackingScore,
    wetAreaClusteringScore,
    circulationAlignmentScore,
    serviceZoneAlignmentScore,
    details: sortedDetails.slice(0, 100), // bounded 100, not 20, to preserve evidence for 10F
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 8),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 8),
    isHeuristic: true,
  };
}
