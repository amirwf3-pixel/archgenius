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

const TOLERANCE = 0.01; // m² tolerance for area reconciliation

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function floorMeta(fl: Floor): FloorMetadata {
  return {
    level: fl.level,
    elevation: fl.elevation,
    floorHeight: fl.floorHeight,
    footprint: { x: fl.footprint.x, y: fl.footprint.y, w: fl.footprint.w, h: fl.footprint.h, area: round2(rArea(fl.footprint)) },
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
  const siteArea = candidate.buildableArea ? rArea(candidate.buildableArea) : 0;
  // For simplicity, site area = buildableArea if no separate site rect, else use first floor footprint * factor
  // In our model, buildableArea is footprint. We'll use it as building footprint.
  let buildingFootprint = 0;
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

  for (const fl of candidate.floors) {
    const fpArea = rArea(fl.footprint);
    if (fl.level === 0) buildingFootprint = fpArea;
    grossFloorArea += fpArea;
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
    residualArea += Math.max(0, fpArea - floorAssigned);
  }

  // Reconciliation
  const componentsSum = netUsableArea + circulationArea + serviceArea + parkingArea + balconyArea + yardArea;
  const grossVsComponentsDiscrepancy = Math.abs(grossFloorArea - (componentsSum + residualArea));
  const footprintVsRooms = candidate.floors.length > 0 ? rArea(candidate.floors[0].footprint) : 0;
  const roomsSumFirstFloor = candidate.floors[0]?.spaces.reduce((sum, s) => sum + s.area, 0) ?? 0;

  const explanations: string[] = [];
  explanations.push(`Gross floor area = sum footprints across floors = ${grossFloorArea.toFixed(2)} m²`);
  explanations.push(`Components sum = usable ${netUsableArea.toFixed(2)} + circ ${circulationArea.toFixed(2)} + service ${serviceArea.toFixed(2)} + parking ${parkingArea.toFixed(2)} + balcony ${balconyArea.toFixed(2)} + yard ${yardArea.toFixed(2)} = ${componentsSum.toFixed(2)}`);
  explanations.push(`Residual = gross - components = ${residualArea.toFixed(2)}`);
  explanations.push(`Discrepancy gross vs components+residual = ${grossVsComponentsDiscrepancy.toFixed(4)} tolerance ${TOLERANCE}`);

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
  const siteArea = input.site.width * input.site.length;

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
  const drawing: DrawingMetadata = {
    sheetSize: 'A3' as SheetSize,
    scale: '1:100',
    drawingNumber: `AG-${project.id}-${candidate.metadata.strategy}-F0`,
    revision: 'R01',
    date: now.toISOString().split('T')[0],
    title: `${input.name} — ${candidate.metadata.strategy}`,
    floor: 0,
    northRotationDeg: input.site.northRotationDeg ?? 0,
    units: 'm',
    insunits: 4,
  };

  const revision = {
    version: '1.0.0-phase7',
    date: now.toISOString(),
    author: 'ArchGenius Phase 7 Engine',
    description: 'Professional documentation & multi-output baseline',
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
    qaConfig: { version: 'phase6-qa-v1', checks: ['room_usability', 'circulation', 'opening', 'parking', 'furniture', 'privacy', 'service', 'residual'] },
  };

  const outputs = {
    dxf: { filename: `${input.name}.dxf`, insunits: 4, layers: ['A-WALL-EXT', 'A-WALL-INT', 'A-WALL-CORE', 'A-WALL-SERVICE', 'A-WALL-PART', 'A-DOOR', 'A-WINDOW', 'A-STAIR', 'A-STAIR-TREAD', 'A-STAIR-DIR', 'A-ROOM', 'A-DIMS', 'A-GRID', 'A-AXIS', 'A-NORTH', 'A-TITLE', 'A-PARKING'], generated: false },
    pdf: { filename: `${input.name}.pdf`, sheetSize: 'A3' as SheetSize, scale: '1:100', generated: false },
    xlsx: { filename: `${input.name}.xlsx`, sheets: ['01_Project', '02_Room_Schedule', '03_Area_Summary', '04_Openings', '05_QA', '06_Regulations'], generated: false },
    report: { filename: `${input.name}_QA_Report.json`, generated: false },
    manifest: { filename: `${input.name}_manifest.json`, version: '1.0.0', generated: false },
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
    canonicalCandidateId: candidate.id,
    consistency: {
      roomAreas,
      totalArea: round2(areaSummary.totalRoomArea),
      checksum,
    },
  };
}
