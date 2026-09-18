/**
 * Phase 8 - Intelligence Types
 *
 * Typed, testable, deterministic structures for architectural intelligence.
 * Single source of truth: canonical geometry.
 */

import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';

export type RelationshipType = 'MUST' | 'PREFER' | 'AVOID';

export type RelationshipKind =
  | 'direct_adjacency' // share wall
  | 'short_path' // path length <=2 via circulation
  | 'same_zone'
  | 'separated_zone'
  | 'direct_access' // door between
  | 'privacy_separation'; // must go through lower privacy circulation

export interface FunctionalRelationship {
  id: string;
  fromType: string;
  toType: string;
  relationship: RelationshipType;
  kind: RelationshipKind;
  weight: number; // 0..10
  reason: string;
  isHard: boolean;
}

export interface FunctionalFinding {
  relationshipId: string;
  fromId: string;
  toId: string;
  satisfied: boolean;
  strength: RelationshipType;
  kind: RelationshipKind;
  weight: number;
  message: string;
  isHard: boolean;
}

export interface FunctionalEvaluation {
  score: number; // 0..1
  satisfiedCount: number;
  totalCount: number;
  mustSatisfied: number;
  mustTotal: number;
  preferSatisfied: number;
  preferTotal: number;
  avoidSatisfied: number; // avoid means NOT adjacent/access
  avoidTotal: number;
  findings: FunctionalFinding[];
  evaluations: Array<FunctionalFinding & { relationship: FunctionalRelationship }>; // alias for explainability, same as findings with relationship attached
  satisfiedMust: number; // alias for mustSatisfied for backwards compat
  satisfiedPrefer: number;
  strengths: string[];
  weaknesses: string[];
}

export interface CirculationEvaluation {
  score: number;
  entranceToLivingPath: number; // steps
  entranceToKitchenPath: number;
  entranceToBedroomPath: number;
  publicCirculationArea: number;
  privateCirculationArea: number;
  serviceCirculationArea: number;
  longestImportantPath: number;
  unnecessaryPathLength: number;
  turnCount: number;
  deadEndCount: number;
  corridorArea: number;
  circulationRatio: number;
  accessGraphQuality: number; // 0..1
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface PrivacyEvaluation {
  score: number; // 0..1
  entranceToBedroomExposure: number; // 0..1 lower better
  entranceToPrivateZone: number;
  livingToBedroom: number;
  livingToBedroomExposure: number; // alias for livingToBedroom
  livingToBathroomExposure: number;
  guestWCLocationScore: number;
  bedroomClusterScore: number;
  masterSeparationScore: number;
  publicPrivateTransitionScore: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface DaylightEvaluation {
  score: number;
  roomScores: Array<{ roomId: string; roomType: string; orientationScore: number; exteriorWallScore: number; windowPotential: number; depthScore: number; overall: number }>;
  livingScore: number;
  diningScore: number;
  bedroomScore: number;
  kitchenScore: number;
  averageDepth: number;
  exteriorWallRatio: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface FurnitureUsability {
  roomId: string;
  roomType: string;
  bedPlacementScore?: number;
  bedAccessScore?: number;
  wardrobeAccessScore?: number;
  doorClearanceScore?: number;
  circulationScore?: number;
  windowRelationshipScore?: number;
  sofaArrangementScore?: number;
  tableClearanceScore?: number;
  workZoneScore?: number;
  counterContinuityScore?: number;
  overall: number;
  issues: string[];
}

export interface FurnitureEvaluation {
  score: number;
  rooms: FurnitureUsability[];
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface KitchenEvaluation {
  score: number | null; // null when NOT EVALUABLE
  hasRefrigerator: boolean;
  hasSink: boolean;
  hasCooktop: boolean;
  counterSequenceScore: number;
  workingTriangleScore: number; // or working zone
  circulationScore: number;
  entranceScore: number;
  diningRelationshipScore: number;
  livingRelationshipScore: number;
  serviceScore: number;
  isEvaluable: boolean;
  reason?: string;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface BedroomEvaluation {
  score: number;
  rooms: Array<{
    roomId: string;
    type: string;
    bedUsability: number;
    wardrobeUsability: number;
    accessScore: number;
    circulationScore: number;
    doorPlacementScore: number;
    windowRelationshipScore: number;
    privacyScore: number;
    proportionScore: number;
    ensuiteRelationshipScore?: number;
    overall: number;
    issues: string[];
  }>;
  masterEnsuiteScore?: number;
  hierarchyScore: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface EntranceServiceEvaluation {
  score: number;
  entranceTransitionScore: number;
  directBedroomExposureScore: number;
  directWCExposureScore: number;
  circulationEfficiencyScore: number;
  foyerScore: number;
  serviceCirculationScore: number;
  bathroomExposureScore: number;
  publicCrossingScore: number;
  serviceAccessEfficiencyScore: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
}

export interface QualityMetrics {
  functional: number;
  circulation: number;
  privacy: number;
  daylight: number;
  usability: number;
  kitchen: number | null; // null when N/A
  bedroom: number;
  entranceService: number;
  overall: number;
  // For transparency
  intelligenceScope: string; // e.g., "Floor 0 Intelligence" or "Whole-Building Intelligence — 3 floors"
  evaluableWeightsSum: number; // sum of weights for evaluable metrics
}

export interface ScoringContribution {
  metric: string; // was keyof QualityMetrics, now string to allow whole-building metrics like verticalCirculation, stacking, interFloor, avgFloorQuality
  raw: number | null;
  normalized: number;
  weight: number; // 0 when N/A
  weightedScore: number;
  range: [number, number];
  reason: string;
  isHard: boolean;
  isHeuristic: boolean;
  isEvaluable: boolean;
}

// Phase 9 — Per-Floor Intelligence
export interface FloorIntelligence {
  floorLevel: number;
  floorId: string; // e.g., footprint id or level identifier
  quality: QualityMetrics;
  contributions: ScoringContribution[];
  overallQuality: number;
  strengths: string[];
  weaknesses: string[];
  tradeOff: string;
  intelligenceScope: string; // e.g., "Floor 0 Intelligence" or "Floor 1 Intelligence"
  detailed: {
    functional: FunctionalEvaluation;
    circulation: CirculationEvaluation;
    privacy: PrivacyEvaluation;
    daylight: DaylightEvaluation;
    furniture: FurnitureEvaluation;
    kitchen: KitchenEvaluation;
    bedroom: BedroomEvaluation;
    entranceService: EntranceServiceEvaluation;
  };
}

// Phase 9 — Vertical Circulation Intelligence
export interface VerticalCirculationEvaluation {
  score: number; // 0..1
  isConnected: boolean;
  floorConnectivity: Array<{ fromLevel: number; toLevel: number; connected: boolean; viaStair: boolean; reason: string }>;
  stairContinuityScore: number;
  stairAlignmentScore: number;
  verticalAccessPath: number[]; // levels reachable from ground
  disconnectedFloors: number[];
  stairCount: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
  isHeuristic: boolean;
}

// Phase 9 — Vertical Stacking Intelligence
export interface StackingEvaluation {
  score: number; // 0..1
  kitchenStackingScore: number;
  bathroomStackingScore: number;
  wetAreaClusteringScore: number;
  circulationAlignmentScore: number;
  serviceZoneAlignmentScore: number;
  details: Array<{ fromLevel: number; toLevel: number; fromType: string; toType: string; overlap: number; aligned: boolean; reason: string }>;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
  isHeuristic: boolean;
}

// Phase 9 — Inter-Floor Intelligence
export interface InterFloorEvaluation {
  score: number;
  entranceToVerticalScore: number;
  publicPrivateTransitionScore: number;
  bedroomDistributionScore: number;
  serviceDistributionScore: number;
  sharedCirculationScore: number;
  privacyTransitionScore: number;
  floorAccessScore: number;
  findings: Finding[];
  strengths: string[];
  weaknesses: string[];
  isHeuristic: boolean;
}

// Phase 9 — Whole-Building Quality
export interface WholeBuildingQuality {
  floorCount: number;
  perFloor: FloorIntelligence[];
  avgFloorQuality: QualityMetrics; // average of per-floor QualityMetrics
  vertical: VerticalCirculationEvaluation;
  stacking: StackingEvaluation;
  interFloor: InterFloorEvaluation;
  overall: number; // weighted combination of avgFloorQuality.overall + vertical + stacking + interFloor
  contributions: ScoringContribution[]; // whole-building contributions (avg metrics + vertical + stacking + interFloor + overall)
  strengths: string[];
  weaknesses: string[];
  tradeOff: string;
  intelligenceScope: string; // e.g., "Whole-Building Intelligence — 3 floors"
  evaluableWeightsSum: number;
}

export interface CandidateEvaluation {
  candidateId: string;
  strategy: string;
  feasible: boolean;
  hardViolations: number;
  hardFindings: Finding[];
  quality: QualityMetrics; // for backward compat, now alias to wholeBuilding.avgFloorQuality or wholeBuilding overall breakdown
  contributions: ScoringContribution[]; // for backward compat, now wholeBuilding.contributions
  overallQuality: number; // whole-building overall
  strengths: string[];
  weaknesses: string[];
  tradeOff: string;
  intelligenceScope: string; // Whole-Building Intelligence etc
  detailed: {
    functional: FunctionalEvaluation;
    circulation: CirculationEvaluation;
    privacy: PrivacyEvaluation;
    daylight: DaylightEvaluation;
    furniture: FurnitureEvaluation;
    kitchen: KitchenEvaluation;
    bedroom: BedroomEvaluation;
    entranceService: EntranceServiceEvaluation;
  };
  // Phase 9 extensions
  floorCount: number;
  perFloor: FloorIntelligence[];
  vertical: VerticalCirculationEvaluation;
  stacking: StackingEvaluation;
  interFloor: InterFloorEvaluation;
  wholeBuilding: WholeBuildingQuality;
}

export interface CandidateComparison {
  candidateA: string;
  candidateB: string;
  feasibilityDiff: string;
  metricDiffs: Array<{ metric: string; a: number; b: number; diff: number; interpretation: string }>;
  strengthsA: string[];
  weaknessesA: string[];
  strengthsB: string[];
  weaknessesB: string[];
  tradeOffExplanation: string;
}

export interface OptimizationResult {
  candidates: CandidateEvaluation[];
  best: CandidateEvaluation;
  alternatives: CandidateEvaluation[];
  comparisons: CandidateComparison[];
  diverseTop: Array<{ label: string; candidate: CandidateEvaluation; reason: string }>;
}
