/**
 * Phase 9 — Explainable Whole-Building Evaluation
 *
 * Every candidate exposes ID, feasibility, hard violations, overall quality, metric breakdown, strengths, weaknesses, trade-offs.
 * Now evaluates every floor independently + vertical circulation + stacking + inter-floor + whole-building.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { CandidateEvaluation, FloorIntelligence } from './types.js';
import { evaluateFunctional } from './adjacency.js';
import { evaluateCirculation } from './circulation.js';
import { evaluatePrivacy } from './privacy.js';
import { evaluateDaylight } from './daylight.js';
import { evaluateFurniture } from './furniture.js';
import { evaluateKitchen } from './kitchen.js';
import { evaluateBedroom } from './bedroom.js';
import { evaluateEntranceService } from './entrance.js';
import { computeQualityMetrics, buildContributions, isFeasible } from './scoring.js';
import { evaluateVerticalCirculation } from './vertical-circulation.js';
import { evaluateStacking } from './stacking.js';
import { evaluateInterFloor } from './inter-floor.js';
import { computeWholeBuildingQuality } from './whole-building.js';

export function evaluateFloor(floor: any, level: number, floorsCount: number): FloorIntelligence {
  return evaluateSingleFloor(floor, floorsCount);
}

function evaluateSingleFloor(floor: any, _floorsCount: number): FloorIntelligence {
  const functional = evaluateFunctional(floor);
  const circulation = evaluateCirculation(floor);
  const privacy = evaluatePrivacy(floor);
  const daylight = evaluateDaylight(floor);
  const furniture = evaluateFurniture(floor);
  const kitchen = evaluateKitchen(floor);
  const bedroom = evaluateBedroom(floor);
  const entranceService = evaluateEntranceService(floor);

  // Phase 9.1 — Single authoritative scope: Floor N Intelligence
  // Ground floor is Floor 0, explicitly labeled as ground for clarity but without legacy "Ground Floor Intelligence" exact string
  const floorScope = floor.level === 0 ? `Floor 0 Intelligence — Ground Floor` : `Floor ${floor.level} Intelligence`;
  const quality = computeQualityMetrics(functional, circulation, privacy, daylight, furniture, kitchen, bedroom, entranceService, floorScope);
  const qualityWithScope = quality;

  const contributions = buildContributions(qualityWithScope);

  const allStrengths = [
    ...functional.strengths,
    ...circulation.strengths,
    ...privacy.strengths,
    ...daylight.strengths,
    ...furniture.strengths,
    ...kitchen.strengths,
    ...bedroom.strengths,
    ...entranceService.strengths,
  ];
  const allWeaknesses = [
    ...functional.weaknesses,
    ...circulation.weaknesses,
    ...privacy.weaknesses,
    ...daylight.weaknesses,
    ...furniture.weaknesses,
    ...kitchen.weaknesses,
    ...bedroom.weaknesses,
    ...entranceService.weaknesses,
  ];

  const uniq = (arr: string[]) => Array.from(new Set(arr));
  const strengths = uniq(allStrengths).slice(0, 8);
  const weaknesses = uniq(allWeaknesses).slice(0, 8);

  const metrics = [
    { name: 'functional', score: quality.functional },
    { name: 'circulation', score: quality.circulation },
    { name: 'privacy', score: quality.privacy },
    { name: 'daylight', score: quality.daylight },
    { name: 'usability', score: quality.usability },
    { name: 'kitchen', score: quality.kitchen },
    { name: 'bedroom', score: quality.bedroom },
    { name: 'entranceService', score: quality.entranceService },
  ].filter(m => m.score !== null && m.score !== undefined) as Array<{ name: string; score: number }>;
  const sortedMetrics = [...metrics].sort((a, b) => b.score - a.score);
  const top = sortedMetrics.slice(0, 2).map(m => m.name).join(', ');
  const bottom = sortedMetrics.slice(-2).map(m => m.name).join(', ');
  const kitchenNote = quality.kitchen === null ? ' Kitchen N/A — Not Evaluated.' : '';
  const tradeOff = `Floor ${floor.level}: Higher ${top}, lower ${bottom}. Overall ${(quality.overall * 100).toFixed(0)}%. Scope: ${floorScope}.${kitchenNote}`;

  return {
    floorLevel: floor.level,
    floorId: floor.level.toString(),
    quality: qualityWithScope,
    contributions,
    overallQuality: quality.overall,
    strengths,
    weaknesses,
    tradeOff,
    intelligenceScope: floorScope,
    detailed: {
      functional,
      circulation,
      privacy,
      daylight,
      furniture,
      kitchen,
      bedroom,
      entranceService,
    },
  };
}

export function evaluateCandidate(candidate: LayoutCandidate): CandidateEvaluation {
  const floorsCount = candidate.floors.length;
  const sortedFloors = [...candidate.floors].sort((a, b) => a.level - b.level);

  // Phase 9: evaluate every floor independently
  const perFloor: FloorIntelligence[] = sortedFloors.map(fl => evaluateSingleFloor(fl, floorsCount));

  // Vertical intelligence
  const vertical = evaluateVerticalCirculation(candidate);
  const stacking = evaluateStacking(candidate);
  const interFloor = evaluateInterFloor(candidate);

  // Whole-building quality
  const wholeBuilding = computeWholeBuildingQuality(perFloor, vertical, stacking, interFloor);

  const { feasible, hardViolations, hardFindings } = isFeasible(candidate);

  // For backward compat, quality = avgFloorQuality, contributions = wholeBuilding.contributions, overallQuality = wholeBuilding.overall, strengths/weaknesses/tradeOff = wholeBuilding
  // detailed = ground floor detailed for backward compat (first floor)
  const groundFloorIntelligence = perFloor.find(pf => pf.floorLevel === 0) ?? perFloor[0];

  return {
    candidateId: candidate.id,
    strategy: candidate.metadata.strategy,
    feasible,
    hardViolations,
    hardFindings,
    quality: wholeBuilding.avgFloorQuality, // backward compat now avg, not just ground floor
    contributions: wholeBuilding.contributions,
    overallQuality: wholeBuilding.overall, // whole-building overall
    strengths: wholeBuilding.strengths,
    weaknesses: wholeBuilding.weaknesses,
    tradeOff: wholeBuilding.tradeOff,
    intelligenceScope: wholeBuilding.intelligenceScope, // Whole-Building Intelligence — N floors
    detailed: groundFloorIntelligence.detailed, // ground floor for backward compat
    floorCount: floorsCount,
    perFloor,
    vertical,
    stacking,
    interFloor,
    wholeBuilding,
  };
}

export function evaluateCandidates(candidates: LayoutCandidate[]): CandidateEvaluation[] {
  return candidates.map(evaluateCandidate).sort((a, b) => {
    // Hard first
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    if (a.hardViolations !== b.hardViolations) return a.hardViolations - b.hardViolations;
    // Then whole-building overall quality descending
    return b.overallQuality - a.overallQuality;
  });
}

