/**
 * Phase 7.1 + 7.2 — Documentation Model Builder & Area Engine
 *
 * Builds DocumentationModel from canonical Project + LayoutCandidate.
 * All values derive from geometry, no duplication, deterministic.
 */

import type { Project } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import { rArea } from '../geometry/rect.js';
import type {
  DocumentationModel,
  RoomScheduleEntry,
  OpeningsScheduleEntry,
  AreaSummary,
  FloorMetadata,
  DrawingMetadata,
  QAFinding,
  RegulationFinding,
  AssumptionsSection,
  SheetSize,
} from './model.js';
import { DOCUMENTATION_SCHEMA_VERSION, SOFTWARE_VERSION } from './model.js';
import { PROJECT_SCHEMA_VERSION } from '../model/project.js';
import { evaluateCandidate } from '../intelligence/evaluation.js';
import { computeBuildableGeometry } from '../site/buildable.js';

const TOLERANCE = 0.01; // m² tolerance for area reconciliation

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function floorMeta(fl: Floor): FloorMetadata {
  const anyFl = fl as any;
  // Phase 10.1: Use actual canonical footprint area (buildableBoundary polygon area) for area, not bounding rect
  // footprint x,y,w,h remain bounding rect as compatibility/presentation (labeled in docs), area is canonical
  let actualArea = rArea(fl.footprint);
  if (anyFl.buildableBoundary && anyFl.buildableBoundary.length >= 3) {
    try {
      // Compute polygon area from buildableBoundary if available
      // Use simple shoelace to avoid import cycle
      let a = 0;
      const poly = anyFl.buildableBoundary as Array<{ x: number; y: number }>;
      for (let i = 0, n = poly.length; i < n; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % n];
        a += p1.x * p2.y - p2.x * p1.y;
      }
      actualArea = Math.abs(a / 2);
    } catch {
      actualArea = rArea(fl.footprint);
    }
  }
  return {
    level: fl.level,
    elevation: fl.elevation,
    floorHeight: fl.floorHeight,
    footprint: { x: fl.footprint.x, y: fl.footprint.y, w: fl.footprint.w, h: fl.footprint.h, area: round2(actualArea) },
    spaceCount: fl.spaces.length,
    wallCount: fl.walls.length,
    openingCount: fl.openings.length,
    stairCount: fl.stairs.length,
    parkingStallCount: fl.parkingStalls.length,
  };
}

function roomEntry(s: Space, floorLevel: number, openings: any[]): RoomScheduleEntry {
  const w = s.rect.w;
  const h = s.rect.h;
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const proportion = maxSide / Math.max(minSide, 1e-6);
  const doors = openings.filter(o => (o.spaceA === s.id || o.spaceB === s.id) && o.type !== 'window').length;
  const wins = openings.filter(o => (o.spaceA === s.id || o.spaceB === s.id) && o.type === 'window').length;
  return {
    id: s.id,
    name: s.label,
    type: s.type,
    floor: floorLevel,
    zone: s.zone,
    privacy: s.privacy,
    area: round2(s.area),
    width: round2(w),
    length: round2(h),
    minSide: round2(minSide),
    maxSide: round2(maxSide),
    proportion: round2(proportion),
    hasExteriorWall: s.hasExteriorWall,
    daylightRequired: !!s.daylightRequired,
    targetArea: round2(s.targetArea),
    minArea: round2(s.minArea),
    wallIds: [...s.wallIds].sort(),
    openingIds: [...s.openingIds].sort(),
    adjacentSpaceIds: [...s.adjacentSpaceIds].sort(),
    openingsSummary: `${doors} door${doors !== 1 ? 's' : ''}, ${wins} window${wins !== 1 ? 's' : ''}`,
  };
}

function openingEntry(o: any): OpeningsScheduleEntry {
  return {
    id: o.id,
    type: o.type,
    floor: o.floor,
    wallId: o.wallId,
    width: round3(o.width),
    height: round3(o.height),
    sill: round3(o.sill),
    swing: o.swing,
    spaceA: o.spaceA,
    spaceB: o.spaceB,
    center: { x: round3(o.center.x), y: round3(o.center.y) },
  };
}

function buildAreaSummary(candidate: LayoutCandidate): AreaSummary {
  const anyCand = candidate as any;
  // Phase 10.1: Use actual canonical areas, not bounding rect
  // siteArea = actual site polygon area if available, else legacy buildableArea rect area
  const siteArea = anyCand.siteAreaValue ?? (candidate.buildableArea ? rArea(candidate.buildableArea) : 0);
  // buildableArea = actual buildable polygon area
  const buildableAreaActual = anyCand.buildableAreaValue ?? 0;
  // buildingFootprint = actual canonical building footprint area (buildableBoundary polygon area), not bounding rect
  // For rectangle, actual == bounding, for L-shape/polygon actual != bounding
  const buildingFootprintActual = buildableAreaActual > 0 ? buildableAreaActual : (candidate.floors[0] ? rArea(candidate.floors[0].footprint) : 0);

  let buildingFootprint = buildingFootprintActual;
  let grossFloorArea = 0;
  let totalRoomArea = 0;
  let netUsableArea = 0;
  let circulationArea = 0;
  let serviceArea = 0;
  let parkingArea = 0;
  let balconyArea = 0;
  let yardArea = 0;
  let residualArea = 0;

  const circTypes = new Set(['corridor', 'stair-hall', 'elevator-hall', 'entrance', 'foyer']);
  const serviceTypes = new Set(['bathroom', 'master-bathroom', 'guest-wc', 'storage', 'utility']);

  // For grossFloorArea, use actual footprint per floor (canonical), not bounding rect
  for (const fl of candidate.floors) {
    // Actual footprint per floor is buildableAreaActual (same for all floors) if available, else footprint rect area
    const fpAreaActual = buildableAreaActual > 0 ? buildableAreaActual : rArea(fl.footprint);
    if (fl.level === 0) buildingFootprint = fpAreaActual;
    grossFloorArea += fpAreaActual;
    let floorAssigned = 0;
    for (const s of fl.spaces) {
      totalRoomArea += s.area;
      floorAssigned += s.area;
      if (circTypes.has(s.type)) circulationArea += s.area;
      else if (serviceTypes.has(s.type)) serviceArea += s.area;
      else if (s.type === 'parking') parkingArea += s.area;
      else if (s.type === 'balcony') balconyArea += s.area;
      else if (s.type === 'yard') yardArea += s.area;
      else netUsableArea += s.area;
    }
    // Residual uses actual footprint, not bounding, to avoid overestimation for L-shape
    residualArea += Math.max(0, fpAreaActual - floorAssigned);
  }

  // Reconciliation
  const componentsSum = netUsableArea + circulationArea + serviceArea + parkingArea + balconyArea + yardArea;
  const grossVsComponentsDiscrepancy = Math.abs(grossFloorArea - (componentsSum + residualArea));
  // Phase 9.1 — Explicit ground-floor reconciliation: ground footprint vs ground rooms
  // This metric is intentionally ground-floor-specific, not whole-building. Whole-building reconciliation is grossVsComponents.
  const groundFootprint = candidate.floors.length > 0 ? rArea(candidate.floors[0].footprint) : 0;
  const groundRoomsSum = candidate.floors[0]?.spaces.reduce((sum, s) => sum + s.area, 0) ?? 0;
  // Keep legacy names for backward compat in return object, but internal semantics are ground-floor-specific
  const footprintVsRooms = groundFootprint;
  const roomsSumFirstFloor = groundRoomsSum;

  const explanations: string[] = [];
  explanations.push(`Gross floor area (whole-building) = sum footprints across all ${candidate.floors.length} floors = ${grossFloorArea.toFixed(2)} m² — whole-building metric`);
  explanations.push(`Components sum = usable ${netUsableArea.toFixed(2)} + circ ${circulationArea.toFixed(2)} + service ${serviceArea.toFixed(2)} + parking ${parkingArea.toFixed(2)} + balcony ${balconyArea.toFixed(2)} + yard ${yardArea.toFixed(2)} = ${componentsSum.toFixed(2)} — whole-building`);
  explanations.push(`Residual = gross - components = ${residualArea.toFixed(2)} — whole-building`);
  explanations.push(`Discrepancy gross vs components+residual = ${grossVsComponentsDiscrepancy.toFixed(4)} tolerance ${TOLERANCE} — whole-building reconciliation`);
  explanations.push(`Ground floor footprint vs ground floor rooms: footprint ${groundFootprint.toFixed(2)} m² vs rooms sum ${groundRoomsSum.toFixed(2)} m² — ground-floor-specific reconciliation, not whole-building`);

  return {
    siteArea: round2(siteArea),
    buildingFootprint: round2(buildingFootprint),
    grossFloorArea: round2(grossFloorArea),
    netUsableArea: round2(netUsableArea),
    circulationArea: round2(circulationArea),
    serviceArea: round2(serviceArea),
    parkingArea: round2(parkingArea),
    balconyArea: round2(balconyArea),
    yardArea: round2(yardArea),
    residualArea: round2(residualArea),
    totalRoomArea: round2(totalRoomArea),
    reconciliation: {
      grossVsComponents: {
        gross: round2(grossFloorArea),
        componentsSum: round2(componentsSum + residualArea),
        discrepancy: round3(grossVsComponentsDiscrepancy),
        withinTolerance: grossVsComponentsDiscrepancy <= TOLERANCE,
      },
      footprintVsRooms: {
        footprint: round2(footprintVsRooms),
        roomsSum: round2(roomsSumFirstFloor),
        residual: round2(Math.max(0, footprintVsRooms - roomsSumFirstFloor)),
        withinTolerance: Math.abs(footprintVsRooms - roomsSumFirstFloor - Math.max(0, footprintVsRooms - roomsSumFirstFloor)) <= TOLERANCE,
      },
      tolerance: TOLERANCE,
      explanation: explanations,
    },
  };
}

function classifyQA(f: any): QAFinding['category'] {
  const code = f.code as string;
  if (code.startsWith('ROOM_')) return 'room';
  if (code.startsWith('CIRC')) return 'circulation';
  if (code.includes('DOOR') || code.includes('WINDOW') || code.startsWith('OPENING_')) return 'opening';
  if (code.startsWith('PARK')) return 'parking';
  if (code.startsWith('FURN')) return 'furniture';
  if (code.includes('PRIVACY')) return 'privacy';
  if (code.includes('SERVICE')) return 'service';
  if (code.includes('RESIDUAL')) return 'residual';
  return 'other';
}

function isHeuristic(code: string): boolean {
  // Heuristic codes are design-quality, not regulation-backed
  const heuristicCodes = new Set([
    'ROOM_TOO_NARROW',
    'ROOM_BAD_PROPORTION',
    'CIRCULATION_DEAD_END',
    'CIRCULATION_EXCESSIVE',
    'DOOR_COLLISION',
    'WINDOW_COLLISION',
    'PARKING_ACCESS_BLOCKED',
    'FURNITURE_BLOCKS_DOOR',
    'SERVICE_EXPOSURE',
    'PRIVACY_WEAK',
    'EXCESSIVE_RESIDUAL',
    'FURNITURE_BLOCKS',
  ]);
  return heuristicCodes.has(code) || code.startsWith('CIRC_') && code !== 'CIRC_INACCESSIBLE_SPACE' && code !== 'CIRC_DISCONNECTED';
}

export function buildDocumentationModel(project: Project, candidate: LayoutCandidate): DocumentationModel {
  const input = project.input;
  const buildableGeom = computeBuildableGeometry(input.site);
  const siteArea = buildableGeom.siteArea;

  const roomSchedule: RoomScheduleEntry[] = [];
  const openingsSchedule: OpeningsScheduleEntry[] = [];

  for (const fl of candidate.floors) {
    for (const s of fl.spaces) {
      roomSchedule.push(roomEntry(s, fl.level, fl.openings));
    }
    for (const o of fl.openings) {
      openingsSchedule.push(openingEntry(o));
    }
  }

  // Deterministic ordering
  roomSchedule.sort((a, b) => a.floor - b.floor || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  openingsSchedule.sort((a, b) => a.floor - b.floor || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));

  const areaSummary = buildAreaSummary(candidate);

  // QA findings: from candidate.findings that are not regulation (or all that are QA)
  const qaFindings: QAFinding[] = candidate.findings
    .filter(f => !f.ruleId || f.code.startsWith('GEO_') || f.code.startsWith('CIRC_') || f.code.startsWith('ROOM_') || f.code.startsWith('FURN_') || f.code.includes('PRIVACY') || f.code.includes('SERVICE') || f.code.includes('PARKING') || f.code.includes('DOOR') || f.code.includes('WINDOW') || f.code.includes('RESIDUAL'))
    .map(f => ({
      code: f.code as string,
      severity: f.severity as any,
      message: f.message,
      entityIds: f.entityIds,
      isHeuristic: isHeuristic(f.code as string),
      category: classifyQA(f),
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || a.severity.localeCompare(b.severity));

  // Regulation findings: those with ruleId
  const regulationFindings: RegulationFinding[] = candidate.findings
    .filter(f => f.ruleId)
    .map(f => {
      const src = f.sources?.[0] as any;
      return {
        ruleId: f.ruleId!,
        title: f.code as string,
        status: (f.status as any) ?? 'VERIFIED',
        severity: f.severity as any,
        source: f.reference ?? (src?.sourceId ?? src?.id ?? 'unknown'),
        edition: src?.edition ?? (f as any).edition ?? 'unknown',
        page: src?.page,
        clause: f.reference,
        result: (f.severity === 'hard' ? 'fail' : f.severity === 'soft' ? 'fail' : 'pass') as 'pass' | 'fail' | 'advisory',
        message: f.message,
        entityIds: f.entityIds,
      };
    })
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  const assumptions: AssumptionsSection = {
    general: [
      'All areas derived from canonical geometry (single source of truth).',
      'DXF, PDF, XLSX, Report, Manifest must agree on room areas within tolerance.',
      'No separate geometry logic for different outputs.',
    ],
    regulations: [
      '9 rules VERIFIED per Phase 5.2 with primary PDFs mabhas4-96.pdf (128 pages) and mabhas-15.pdf (84 pages).',
      '2 municipal rules remain REQUIRES_SOURCE_VERIFICATION.',
      '3 rules NOT_IMPLEMENTED with Tier-1 backing.',
      'Heuristic thresholds (corridor width, proportion, dead-end, etc.) are NOT verified legal requirements and are marked isHeuristic=true.',
    ],
    geometry: [
      'Internal units meters, DXF mm INSUNITS=4, tolerance 1e-6 m.',
      'Rectangular sites only, residential.',
      'Area reconciliation tolerance 0.01 m².',
    ],
    qa: [
      'QA findings with isHeuristic=true are design-quality heuristics, not legal.',
      'HARD findings indicate unusable or invalid geometry.',
    ],
  };

  const now = new Date();
  // Phase 9.1 — Whole-building drawing number: AG-{candidateId}-WB, not F0
  const wbDrawingNumber = `AG-${candidate.id}-WB`;
  const drawing: DrawingMetadata = {
    sheetSize: 'A3' as SheetSize,
    scale: '1:100',
    drawingNumber: wbDrawingNumber,
    revision: 'R01',
    date: now.toISOString().split('T')[0],
    title: `${input.name} — ${candidate.metadata.strategy}`,
    floor: 0,
    northRotationDeg: input.site.northRotationDeg ?? 0,
    units: 'm',
    insunits: 4,
  };

  const revision = {
    version: '1.0.0-phase11',
    date: now.toISOString(),
    author: 'ArchGenius Phase 11 Parametric Architectural Planning Engine',
    description: 'Canonical polygon rooms (rectangle, L-shape, orthogonal up to 8 verts), parametric constraints, locking, controlled editing, site-aware placement, wall generation from polygon',
    schemaVersion: DOCUMENTATION_SCHEMA_VERSION,
  };

  const generation = {
    timestamp: now.toISOString(),
    softwareVersion: SOFTWARE_VERSION,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    seed: candidate.metadata.seed,
    strategy: candidate.metadata.strategy,
    deterministic: true,
    regulationPacks: candidate.metadata.regulationPacks,
    qaConfig: { version: 'phase11-v1', checks: ['room_usability', 'circulation', 'opening', 'parking', 'furniture', 'privacy', 'service', 'residual', 'functional', 'daylight', 'kitchen', 'bedroom', 'entrance-service', 'vertical-circulation', 'stacking', 'inter-floor', 'whole-building', 'site-geometry', 'site-containment', 'site-parking', 'site-setback', 'site-buildable', 'room-polygon', 'parametric-constraints', 'locking', 'editing'] },
  };

  const outputs = {
    dxf: { filename: `${input.name}.dxf`, insunits: 4, layers: ['A-WALL-EXT', 'A-WALL-INT', 'A-WALL-CORE', 'A-WALL-SERVICE', 'A-WALL-PART', 'A-DOOR', 'A-WINDOW', 'A-STAIR', 'A-STAIR-TREAD', 'A-STAIR-DIR', 'A-ROOM', 'A-DIMS', 'A-GRID', 'A-AXIS', 'A-NORTH', 'A-TITLE', 'A-PARKING', 'A-SITE', 'A-BLDG-OUT', 'A-SETBACK'], generated: false },
    pdf: { filename: `${input.name}.pdf`, sheetSize: 'A3' as SheetSize, scale: '1:100', generated: false },
    xlsx: { filename: `${input.name}.xlsx`, sheets: ['01_Project', '02_Room_Schedule', '03_Area_Summary', '04_Openings', '05_QA', '06_Regulations', '07_Intelligence', '08_PerFloor', '09_Vertical', '10_Stacking', '11_Site'], generated: false },
    report: { filename: `${input.name}_QA_Report.json`, generated: false },
    manifest: { filename: `${input.name}_manifest.json`, version: '1.0.0', generated: false },
  };

  // Phase 9 — Whole-building intelligence evaluation
  const intelEval = evaluateCandidate(candidate);
  const intelligence = {
    candidateId: intelEval.candidateId,
    strategy: intelEval.strategy,
    feasible: intelEval.feasible,
    hardViolations: intelEval.hardViolations,
    overallQuality: Math.round(intelEval.overallQuality * 1000) / 1000,
    floorCount: intelEval.floorCount,
    intelligenceScope: intelEval.intelligenceScope,
    quality: {
      functional: Math.round(intelEval.quality.functional * 1000) / 1000,
      circulation: Math.round(intelEval.quality.circulation * 1000) / 1000,
      privacy: Math.round(intelEval.quality.privacy * 1000) / 1000,
      daylight: Math.round(intelEval.quality.daylight * 1000) / 1000,
      usability: Math.round(intelEval.quality.usability * 1000) / 1000,
      kitchen: intelEval.quality.kitchen !== null ? Math.round(intelEval.quality.kitchen * 1000) / 1000 : null,
      bedroom: Math.round(intelEval.quality.bedroom * 1000) / 1000,
      entranceService: Math.round(intelEval.quality.entranceService * 1000) / 1000,
      overall: Math.round(intelEval.quality.overall * 1000) / 1000,
      intelligenceScope: intelEval.quality.intelligenceScope,
      evaluableWeightsSum: Math.round(intelEval.quality.evaluableWeightsSum * 1000) / 1000,
    },
    contributions: intelEval.contributions.map(c => ({
      metric: c.metric,
      raw: c.raw !== null ? Math.round(c.raw * 1000) / 1000 : null,
      normalized: Math.round(c.normalized * 1000) / 1000,
      weight: c.weight,
      weightedScore: Math.round(c.weightedScore * 1000) / 1000,
      range: c.range as [number, number],
      reason: c.reason,
      isHard: c.isHard,
      isHeuristic: c.isHeuristic,
      isEvaluable: c.isEvaluable,
    })),
    strengths: intelEval.strengths,
    weaknesses: intelEval.weaknesses,
    tradeOff: intelEval.tradeOff,
    detailed: {
      functional: { score: Math.round(intelEval.detailed.functional.score * 1000) / 1000, findings: intelEval.detailed.functional.findings.length, strengths: intelEval.detailed.functional.strengths, weaknesses: intelEval.detailed.functional.weaknesses },
      circulation: { score: Math.round(intelEval.detailed.circulation.score * 1000) / 1000, circulationRatio: Math.round(intelEval.detailed.circulation.circulationRatio * 1000) / 1000, deadEndCount: intelEval.detailed.circulation.deadEndCount, corridorArea: Math.round(intelEval.detailed.circulation.corridorArea * 100) / 100, strengths: intelEval.detailed.circulation.strengths, weaknesses: intelEval.detailed.circulation.weaknesses },
      privacy: { score: Math.round(intelEval.detailed.privacy.score * 1000) / 1000, findings: intelEval.detailed.privacy.findings.length, strengths: intelEval.detailed.privacy.strengths, weaknesses: intelEval.detailed.privacy.weaknesses },
      daylight: { score: Math.round(intelEval.detailed.daylight.score * 1000) / 1000, livingScore: Math.round(intelEval.detailed.daylight.livingScore * 1000) / 1000, bedroomScore: Math.round(intelEval.detailed.daylight.bedroomScore * 1000) / 1000, strengths: intelEval.detailed.daylight.strengths, weaknesses: intelEval.detailed.daylight.weaknesses },
      furniture: { score: Math.round(intelEval.detailed.furniture.score * 1000) / 1000, findings: intelEval.detailed.furniture.findings.length, strengths: intelEval.detailed.furniture.strengths, weaknesses: intelEval.detailed.furniture.weaknesses },
      kitchen: { score: intelEval.detailed.kitchen.score !== null ? Math.round(intelEval.detailed.kitchen.score * 1000) / 1000 : null, isEvaluable: intelEval.detailed.kitchen.isEvaluable, reason: intelEval.detailed.kitchen.reason, strengths: intelEval.detailed.kitchen.strengths, weaknesses: intelEval.detailed.kitchen.weaknesses },
      bedroom: { score: Math.round(intelEval.detailed.bedroom.score * 1000) / 1000, findings: intelEval.detailed.bedroom.findings.length, strengths: intelEval.detailed.bedroom.strengths, weaknesses: intelEval.detailed.bedroom.weaknesses },
      entranceService: { score: Math.round(intelEval.detailed.entranceService.score * 1000) / 1000, findings: intelEval.detailed.entranceService.findings.length, strengths: intelEval.detailed.entranceService.strengths, weaknesses: intelEval.detailed.entranceService.weaknesses },
    },
    perFloor: intelEval.perFloor.map(pf => ({
      floorLevel: pf.floorLevel,
      quality: {
        functional: Math.round(pf.quality.functional * 1000) / 1000,
        circulation: Math.round(pf.quality.circulation * 1000) / 1000,
        privacy: Math.round(pf.quality.privacy * 1000) / 1000,
        daylight: Math.round(pf.quality.daylight * 1000) / 1000,
        usability: Math.round(pf.quality.usability * 1000) / 1000,
        kitchen: pf.quality.kitchen !== null ? Math.round(pf.quality.kitchen * 1000) / 1000 : null,
        bedroom: Math.round(pf.quality.bedroom * 1000) / 1000,
        entranceService: Math.round(pf.quality.entranceService * 1000) / 1000,
        overall: Math.round(pf.quality.overall * 1000) / 1000,
        intelligenceScope: pf.quality.intelligenceScope,
        evaluableWeightsSum: Math.round(pf.quality.evaluableWeightsSum * 1000) / 1000,
      },
      overallQuality: Math.round(pf.overallQuality * 1000) / 1000,
      contributions: pf.contributions.map(c => ({
        metric: c.metric,
        raw: c.raw !== null ? Math.round(c.raw * 1000) / 1000 : null,
        normalized: Math.round(c.normalized * 1000) / 1000,
        weight: c.weight,
        weightedScore: Math.round(c.weightedScore * 1000) / 1000,
        range: c.range as [number, number],
        reason: c.reason,
        isHard: c.isHard,
        isHeuristic: c.isHeuristic,
        isEvaluable: c.isEvaluable,
      })),
      strengths: pf.strengths,
      weaknesses: pf.weaknesses,
      tradeOff: pf.tradeOff,
      intelligenceScope: pf.intelligenceScope,
      detailed: {
        functional: { score: Math.round(pf.detailed.functional.score * 1000) / 1000, findings: pf.detailed.functional.findings.length, strengths: pf.detailed.functional.strengths, weaknesses: pf.detailed.functional.weaknesses },
        circulation: { score: Math.round(pf.detailed.circulation.score * 1000) / 1000, circulationRatio: Math.round(pf.detailed.circulation.circulationRatio * 1000) / 1000, deadEndCount: pf.detailed.circulation.deadEndCount, corridorArea: Math.round(pf.detailed.circulation.corridorArea * 100) / 100, strengths: pf.detailed.circulation.strengths, weaknesses: pf.detailed.circulation.weaknesses },
        privacy: { score: Math.round(pf.detailed.privacy.score * 1000) / 1000, findings: pf.detailed.privacy.findings.length, strengths: pf.detailed.privacy.strengths, weaknesses: pf.detailed.privacy.weaknesses },
        daylight: { score: Math.round(pf.detailed.daylight.score * 1000) / 1000, livingScore: Math.round(pf.detailed.daylight.livingScore * 1000) / 1000, bedroomScore: Math.round(pf.detailed.daylight.bedroomScore * 1000) / 1000, strengths: pf.detailed.daylight.strengths, weaknesses: pf.detailed.daylight.weaknesses },
        furniture: { score: Math.round(pf.detailed.furniture.score * 1000) / 1000, findings: pf.detailed.furniture.findings.length, strengths: pf.detailed.furniture.strengths, weaknesses: pf.detailed.furniture.weaknesses },
        kitchen: { score: pf.detailed.kitchen.score !== null ? Math.round(pf.detailed.kitchen.score * 1000) / 1000 : null, isEvaluable: pf.detailed.kitchen.isEvaluable, reason: pf.detailed.kitchen.reason, strengths: pf.detailed.kitchen.strengths, weaknesses: pf.detailed.kitchen.weaknesses },
        bedroom: { score: Math.round(pf.detailed.bedroom.score * 1000) / 1000, findings: pf.detailed.bedroom.findings.length, strengths: pf.detailed.bedroom.strengths, weaknesses: pf.detailed.bedroom.weaknesses },
        entranceService: { score: Math.round(pf.detailed.entranceService.score * 1000) / 1000, findings: pf.detailed.entranceService.findings.length, strengths: pf.detailed.entranceService.strengths, weaknesses: pf.detailed.entranceService.weaknesses },
      },
    })),
    vertical: {
      score: Math.round(intelEval.vertical.score * 1000) / 1000,
      isConnected: intelEval.vertical.isConnected,
      stairContinuityScore: Math.round(intelEval.vertical.stairContinuityScore * 1000) / 1000,
      stairAlignmentScore: Math.round(intelEval.vertical.stairAlignmentScore * 1000) / 1000,
      disconnectedFloors: intelEval.vertical.disconnectedFloors,
      stairCount: intelEval.vertical.stairCount,
      findings: intelEval.vertical.findings.length,
      strengths: intelEval.vertical.strengths,
      weaknesses: intelEval.vertical.weaknesses,
      isHeuristic: intelEval.vertical.isHeuristic,
    },
    stacking: {
      score: Math.round(intelEval.stacking.score * 1000) / 1000,
      kitchenStackingScore: Math.round(intelEval.stacking.kitchenStackingScore * 1000) / 1000,
      bathroomStackingScore: Math.round(intelEval.stacking.bathroomStackingScore * 1000) / 1000,
      wetAreaClusteringScore: Math.round(intelEval.stacking.wetAreaClusteringScore * 1000) / 1000,
      circulationAlignmentScore: Math.round(intelEval.stacking.circulationAlignmentScore * 1000) / 1000,
      serviceZoneAlignmentScore: Math.round(intelEval.stacking.serviceZoneAlignmentScore * 1000) / 1000,
      findings: intelEval.stacking.findings.length,
      strengths: intelEval.stacking.strengths,
      weaknesses: intelEval.stacking.weaknesses,
      isHeuristic: intelEval.stacking.isHeuristic,
      details: intelEval.stacking.details.map(d => ({
        fromLevel: d.fromLevel,
        toLevel: d.toLevel,
        fromType: d.fromType,
        toType: d.toType,
        overlap: Math.round(d.overlap * 1000) / 1000,
        aligned: d.aligned,
        reason: d.reason,
      })),
    },
    interFloor: {
      score: Math.round(intelEval.interFloor.score * 1000) / 1000,
      entranceToVerticalScore: Math.round(intelEval.interFloor.entranceToVerticalScore * 1000) / 1000,
      publicPrivateTransitionScore: Math.round(intelEval.interFloor.publicPrivateTransitionScore * 1000) / 1000,
      bedroomDistributionScore: Math.round(intelEval.interFloor.bedroomDistributionScore * 1000) / 1000,
      serviceDistributionScore: Math.round(intelEval.interFloor.serviceDistributionScore * 1000) / 1000,
      sharedCirculationScore: Math.round(intelEval.interFloor.sharedCirculationScore * 1000) / 1000,
      privacyTransitionScore: Math.round(intelEval.interFloor.privacyTransitionScore * 1000) / 1000,
      floorAccessScore: Math.round(intelEval.interFloor.floorAccessScore * 1000) / 1000,
      findings: intelEval.interFloor.findings.length,
      strengths: intelEval.interFloor.strengths,
      weaknesses: intelEval.interFloor.weaknesses,
      isHeuristic: intelEval.interFloor.isHeuristic,
    },
    wholeBuilding: {
      floorCount: intelEval.wholeBuilding.floorCount,
      avgFloorQuality: {
        functional: Math.round(intelEval.wholeBuilding.avgFloorQuality.functional * 1000) / 1000,
        circulation: Math.round(intelEval.wholeBuilding.avgFloorQuality.circulation * 1000) / 1000,
        privacy: Math.round(intelEval.wholeBuilding.avgFloorQuality.privacy * 1000) / 1000,
        daylight: Math.round(intelEval.wholeBuilding.avgFloorQuality.daylight * 1000) / 1000,
        usability: Math.round(intelEval.wholeBuilding.avgFloorQuality.usability * 1000) / 1000,
        kitchen: intelEval.wholeBuilding.avgFloorQuality.kitchen !== null ? Math.round(intelEval.wholeBuilding.avgFloorQuality.kitchen * 1000) / 1000 : null,
        bedroom: Math.round(intelEval.wholeBuilding.avgFloorQuality.bedroom * 1000) / 1000,
        entranceService: Math.round(intelEval.wholeBuilding.avgFloorQuality.entranceService * 1000) / 1000,
        overall: Math.round(intelEval.wholeBuilding.avgFloorQuality.overall * 1000) / 1000,
        intelligenceScope: intelEval.wholeBuilding.avgFloorQuality.intelligenceScope,
        evaluableWeightsSum: Math.round(intelEval.wholeBuilding.avgFloorQuality.evaluableWeightsSum * 1000) / 1000,
      },
      overall: Math.round(intelEval.wholeBuilding.overall * 1000) / 1000,
      evaluableWeightsSum: Math.round(intelEval.wholeBuilding.evaluableWeightsSum * 1000) / 1000,
      contributions: intelEval.wholeBuilding.contributions.map(c => ({
        metric: c.metric,
        raw: c.raw !== null ? Math.round(c.raw * 1000) / 1000 : null,
        normalized: Math.round(c.normalized * 1000) / 1000,
        weight: c.weight,
        weightedScore: Math.round(c.weightedScore * 1000) / 1000,
        range: c.range as [number, number],
        reason: c.reason,
        isHard: c.isHard,
        isHeuristic: c.isHeuristic,
        isEvaluable: c.isEvaluable,
      })),
      strengths: intelEval.wholeBuilding.strengths,
      weaknesses: intelEval.wholeBuilding.weaknesses,
      tradeOff: intelEval.wholeBuilding.tradeOff,
      intelligenceScope: intelEval.wholeBuilding.intelligenceScope,
    },
  };

  const roomAreas: Record<string, number> = {};
  for (const r of roomSchedule) {
    roomAreas[r.id] = r.area;
  }
  // Simple checksum: sum of areas *100 rounded
  const checksum = Object.values(roomAreas).reduce((sum, a) => sum + Math.round(a * 100), 0).toString(16);

  return {
    project: {
      id: project.id,
      name: input.name,
      client: (input as any).client,
      description: (input as any).description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      schemaVersion: project.schemaVersion,
    },
    input,
    site: {
      shape: input.site.shape,
      width: input.site.width,
      length: input.site.length,
      area: round2(siteArea),
      accessSide: input.site.accessSide,
      northRotationDeg: input.site.northRotationDeg,
      buildableArea: round2(buildableGeom.buildableArea),
      buildableBoundingRect: { x: round2(buildableGeom.buildableBoundingRect.x), y: round2(buildableGeom.buildableBoundingRect.y), w: round2(buildableGeom.buildableBoundingRect.w), h: round2(buildableGeom.buildableBoundingRect.h), area: round2(buildableGeom.buildableArea) },
      buildableRects: buildableGeom.buildableRects.map(r => ({ x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h), area: round2(r.w * r.h) })),
      siteBoundary: buildableGeom.siteBoundary.map(p => ({ x: round2(p.x), y: round2(p.y) })),
      buildableBoundary: buildableGeom.buildableBoundary.map(p => ({ x: round2(p.x), y: round2(p.y) })),
      setbacks: { north: buildableGeom.appliedSetbacks.find(s => s.direction === 'north')?.value ?? 0, south: buildableGeom.appliedSetbacks.find(s => s.direction === 'south')?.value ?? 0, east: buildableGeom.appliedSetbacks.find(s => s.direction === 'east')?.value ?? 0, west: buildableGeom.appliedSetbacks.find(s => s.direction === 'west')?.value ?? 0 },
      setbackSources: buildableGeom.appliedSetbacks.map(s => ({ direction: s.direction, value: s.value, source: s.source, status: s.status, reference: s.reference })),
      jurisdiction: input.site.jurisdiction,
      city: input.site.city,
      parkingLayout: (input.site as any).parkingLayout ?? 'auto',
      lShape: (input.site as any).lShape,
      polygonVertices: (input.site as any).polygon?.vertices,
      siteValidation: { isValid: buildableGeom.isValid, errors: buildableGeom.validationErrors },
    },
    building: {
      type: input.building.type,
      floors: input.building.floors,
      unitsPerFloor: input.building.unitsPerFloor,
      bedrooms: input.building.bedrooms,
      masterBedrooms: input.building.masterBedrooms,
      bathrooms: input.building.bathrooms,
      wc: input.building.wc,
      kitchenType: input.building.kitchenType,
      parkingSpaces: input.building.parkingSpaces,
      hasElevator: input.building.hasElevator,
      hasStair: input.building.hasStair,
      hasBalcony: input.building.hasBalcony,
      hasStorage: input.building.hasStorage,
    },
    floors: candidate.floors.map(floorMeta).sort((a, b) => a.level - b.level),
    drawing,
    roomSchedule,
    areaSummary,
    openingsSchedule,
    qaFindings,
    regulationFindings,
    assumptions,
    revision,
    generation,
    outputs,
    metrics: candidate.metrics,
    intelligence,
    canonicalCandidateId: candidate.id,
    consistency: {
      roomAreas,
      totalArea: round2(areaSummary.totalRoomArea),
      checksum,
    },
  };
}
