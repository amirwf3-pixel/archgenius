/**
 * Phase 7.1 — Documentation Model
 *
 * Structured documentation/output model that references canonical geometry
 * instead of duplicating geometry. All values derive from ProjectInput,
 * LayoutCandidate, Floor, Space, Wall, Opening, etc.
 */

import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import type { LayoutMetrics } from '../optimizer/metrics.js';

export type SheetSize = 'A3' | 'A2' | 'A1' | 'A0';

export interface ProjectMetadata {
  id: string;
  name: string;
  client?: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}

export interface BuildingMetadata {
  type: string;
  floors: number;
  unitsPerFloor?: number;
  bedrooms: number;
  masterBedrooms: number;
  bathrooms: number;
  wc: number;
  kitchenType: string;
  parkingSpaces: number;
  hasElevator?: boolean;
  hasStair?: boolean;
  hasBalcony?: boolean;
  hasStorage?: boolean;
}

export interface SiteMetadata {
  shape: string;
  width: number;
  length: number;
  area: number;
  accessSide: string;
  northRotationDeg?: number;
  // Phase 10 — site/context
  buildableArea?: number;
  buildableBoundingRect?: { x: number; y: number; w: number; h: number; area: number };
  buildableRects?: Array<{ x: number; y: number; w: number; h: number; area: number }>;
  siteBoundary?: Array<{ x: number; y: number }>;
  buildableBoundary?: Array<{ x: number; y: number }>;
  setbacks?: { north: number; south: number; east: number; west: number };
  setbackSources?: Array<{ direction: string; value: number; source: string; status: string; reference?: string }>;
  jurisdiction?: string;
  city?: string;
  parkingLayout?: string;
  lShape?: { width: number; length: number; notchWidth: number; notchLength: number; notchCorner: string };
  polygonVertices?: Array<{ x: number; y: number }>;
  siteValidation?: { isValid: boolean; errors: string[] };
}

export interface FloorMetadata {
  level: number;
  elevation: number;
  floorHeight: number;
  footprint: { x: number; y: number; w: number; h: number; area: number };
  spaceCount: number;
  wallCount: number;
  openingCount: number;
  stairCount: number;
  parkingStallCount: number;
}

export interface DrawingMetadata {
  sheetSize: SheetSize;
  scale: string; // e.g. "1:100"
  drawingNumber: string;
  revision: string;
  date: string; // ISO date
  title: string;
  floor: number;
  northRotationDeg: number;
  units: 'mm' | 'm';
  insunits: number; // DXF INSUNITS, 4 = mm
}

export interface RoomScheduleEntry {
  id: string;
  name: string;
  type: string;
  floor: number;
  zone: string;
  privacy: string;
  area: number; // m²
  width: number; // m
  length: number; // m
  minSide: number;
  maxSide: number;
  proportion: number; // max/min
  hasExteriorWall: boolean;
  daylightRequired: boolean;
  targetArea: number;
  minArea: number;
  wallIds: string[];
  openingIds: string[];
  adjacentSpaceIds: string[];
  openingsSummary: string; // e.g. "1 door, 1 window"
}

export interface OpeningsScheduleEntry {
  id: string;
  type: string;
  floor: number;
  wallId: string;
  width: number;
  height: number;
  sill: number;
  swing?: string;
  spaceA?: string;
  spaceB?: string;
  center: { x: number; y: number };
}

export interface AreaSummary {
  siteArea: number;
  buildingFootprint: number; // footprint of first floor or buildable?
  grossFloorArea: number; // sum of footprint * floors
  netUsableArea: number; // sum of usable (non-circ) spaces
  circulationArea: number;
  serviceArea: number; // bathroom + wc + storage + utility
  parkingArea: number;
  balconyArea: number;
  yardArea: number;
  residualArea: number; // footprint - assigned
  totalRoomArea: number; // sum of all spaces
  // Reconciliation
  reconciliation: {
    grossVsComponents: { gross: number; componentsSum: number; discrepancy: number; withinTolerance: boolean };
    footprintVsRooms: { footprint: number; roomsSum: number; residual: number; withinTolerance: boolean };
    tolerance: number;
    explanation: string[];
  };
}

export interface RegulationFinding {
  ruleId: string;
  title: string;
  status: 'VERIFIED' | 'REQUIRES_SOURCE_VERIFICATION' | 'NOT_IMPLEMENTED' | 'DEPRECATED' | string;
  severity: 'hard' | 'soft' | 'advisory' | string;
  actualValue?: number | string;
  threshold?: number | string;
  operator?: string;
  unit?: string;
  source?: string;
  edition?: string;
  page?: number;
  clause?: string;
  result: 'pass' | 'fail' | 'advisory';
  message: string;
  entityIds?: string[];
}

export interface QAFinding {
  code: string;
  severity: 'hard' | 'soft' | 'advisory';
  message: string;
  entityIds?: string[];
  isHeuristic: boolean; // true if design heuristic, false if regulation-backed
  category: 'room' | 'circulation' | 'opening' | 'parking' | 'furniture' | 'privacy' | 'service' | 'residual' | 'other';
}

export interface AssumptionsSection {
  general: string[];
  regulations: string[];
  geometry: string[];
  qa: string[];
}

export interface RevisionMetadata {
  version: string;
  date: string;
  author: string;
  description: string;
  schemaVersion: number;
}

export interface GenerationMetadata {
  timestamp: string; // ISO
  softwareVersion: string;
  schemaVersion: number;
  seed: number;
  strategy: string;
  deterministic: boolean;
  regulationPacks: Array<{ id: string; edition: string }>;
  qaConfig: { version: string; checks: string[] };
}

export interface OutputMetadata {
  dxf: { filename: string; insunits: number; layers: string[]; generated: boolean };
  pdf: { filename: string; sheetSize: SheetSize; scale: string; generated: boolean };
  xlsx: { filename: string; sheets: string[]; generated: boolean };
  report: { filename: string; generated: boolean };
  manifest: { filename: string; version: string; generated: boolean };
}

export interface DocumentationModel {
  project: ProjectMetadata;
  input: ProjectInput;
  site: SiteMetadata;
  building: BuildingMetadata;
  floors: FloorMetadata[];
  drawing: DrawingMetadata;
  roomSchedule: RoomScheduleEntry[];
  areaSummary: AreaSummary;
  openingsSchedule: OpeningsScheduleEntry[];
  qaFindings: QAFinding[];
  regulationFindings: RegulationFinding[];
  assumptions: AssumptionsSection;
  revision: RevisionMetadata;
  generation: GenerationMetadata;
  outputs: OutputMetadata;
  metrics: LayoutMetrics;
  intelligence?: IntelligenceModel;
  // Reference to canonical candidate id, not duplicated geometry
  canonicalCandidateId: string;
  // For consistency checks, we store a hash of key values? But we keep deterministic values
  consistency: {
    roomAreas: Record<string, number>; // id -> area
    totalArea: number;
    checksum: string; // simple deterministic checksum of room areas
  };
}

export interface IntelligenceMetrics {
  functional: number;
  circulation: number;
  privacy: number;
  daylight: number;
  usability: number;
  kitchen: number | null; // null when N/A
  bedroom: number;
  entranceService: number;
  overall: number;
  intelligenceScope: string;
  evaluableWeightsSum: number;
}

export interface IntelligenceContribution {
  metric: string;
  raw: number | null;
  normalized: number;
  weight: number;
  weightedScore: number;
  range: [number, number];
  reason: string;
  isHard: boolean;
  isHeuristic: boolean;
  isEvaluable: boolean;
}

export interface IntelligenceModel {
  candidateId: string;
  strategy: string;
  feasible: boolean;
  hardViolations: number;
  overallQuality: number; // whole-building overall
  floorCount: number;
  quality: IntelligenceMetrics; // avg floor quality for backward compat
  contributions: IntelligenceContribution[]; // whole-building contributions
  strengths: string[];
  weaknesses: string[];
  tradeOff: string;
  intelligenceScope: string; // Whole-Building Intelligence — N floors
  detailed: {
    functional: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
    circulation: { score: number; circulationRatio: number; deadEndCount: number; corridorArea: number; strengths: string[]; weaknesses: string[] };
    privacy: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
    daylight: { score: number; livingScore: number; bedroomScore: number; strengths: string[]; weaknesses: string[] };
    furniture: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
    kitchen: { score: number | null; isEvaluable: boolean; strengths: string[]; weaknesses: string[]; reason?: string };
    bedroom: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
    entranceService: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
  };
  // Phase 9 — Whole-building extensions
  perFloor: Array<{
    floorLevel: number;
    quality: IntelligenceMetrics;
    overallQuality: number;
    contributions: IntelligenceContribution[];
    strengths: string[];
    weaknesses: string[];
    tradeOff: string;
    intelligenceScope: string;
    detailed: {
      functional: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
      circulation: { score: number; circulationRatio: number; deadEndCount: number; corridorArea: number; strengths: string[]; weaknesses: string[] };
      privacy: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
      daylight: { score: number; livingScore: number; bedroomScore: number; strengths: string[]; weaknesses: string[] };
      furniture: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
      kitchen: { score: number | null; isEvaluable: boolean; strengths: string[]; weaknesses: string[]; reason?: string };
      bedroom: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
      entranceService: { score: number; findings: number; strengths: string[]; weaknesses: string[] };
    };
  }>;
  vertical: {
    score: number;
    isConnected: boolean;
    stairContinuityScore: number;
    stairAlignmentScore: number;
    disconnectedFloors: number[];
    stairCount: number;
    findings: number;
    strengths: string[];
    weaknesses: string[];
    isHeuristic: boolean;
  };
  stacking: {
    score: number;
    kitchenStackingScore: number;
    bathroomStackingScore: number;
    wetAreaClusteringScore: number;
    circulationAlignmentScore: number;
    serviceZoneAlignmentScore: number;
    findings: number;
    strengths: string[];
    weaknesses: string[];
    isHeuristic: boolean;
    details?: Array<{ fromLevel: number; toLevel: number; fromType: string; toType: string; overlap: number; aligned: boolean; reason: string }>;
  };
  interFloor: {
    score: number;
    entranceToVerticalScore: number;
    publicPrivateTransitionScore: number;
    bedroomDistributionScore: number;
    serviceDistributionScore: number;
    sharedCirculationScore: number;
    privacyTransitionScore: number;
    floorAccessScore: number;
    findings: number;
    strengths: string[];
    weaknesses: string[];
    isHeuristic: boolean;
  };
  wholeBuilding: {
    floorCount: number;
    avgFloorQuality: IntelligenceMetrics;
    overall: number;
    evaluableWeightsSum: number;
    contributions: IntelligenceContribution[];
    strengths: string[];
    weaknesses: string[];
    tradeOff: string;
    intelligenceScope: string;
  };
}

export const DOCUMENTATION_SCHEMA_VERSION = 6;
export const SOFTWARE_VERSION = '0.11.1-phase11.1';
