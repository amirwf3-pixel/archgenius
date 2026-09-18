/**
 * Phase 7 — Project Manifest
 *
 * Deterministic JSON export with enough info to reproduce project.
 * Versioned, includes input, geometry config, strategy, regulation packs, QA config, software version, generation metadata, output manifest.
 */

import type { DocumentationModel } from './model.js';
import type { Project } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';
import { DOCUMENTATION_SCHEMA_VERSION, SOFTWARE_VERSION } from './model.js';

export interface ProjectManifest {
  manifestVersion: string;
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    client?: string;
    createdAt: number;
    updatedAt: number;
  };
  input: {
    site: { width: number; length: number; shape: string; accessSide: string; area: number; buildableArea?: number; setbacks?: { north: number; south: number; east: number; west: number }; jurisdiction?: string; city?: string; parkingLayout?: string; lShape?: any; polygonVertices?: any };
    building: { type: string; floors: number; bedrooms: number; masterBedrooms: number; bathrooms: number; wc: number; parkingSpaces: number };
    seed: number;
    deterministic: boolean;
  };
  geometry: {
    candidateId: string;
    strategy: string;
    floors: number;
    footprint: { x: number; y: number; w: number; h: number };
    totalSpaces: number;
    totalWalls: number;
    totalOpenings: number;
    totalStairs: number;
    siteShape: string;
    buildableArea: number;
    siteValidation: { isValid: boolean; errors: string[] };
  };
  regulation: {
    packs: Array<{ id: string; edition: string }>;
    verifiedCount: number;
    requiresVerificationCount: number;
    notImplementedCount: number;
  };
  qa: {
    configVersion: string;
    hardCount: number;
    softCount: number;
    advisoryCount: number;
    heuristicCount: number;
  };
  intelligence?: {
    feasible: boolean;
    hardViolations: number;
    overallQuality: number;
    quality: Record<string, number | null>;
    strategy: string;
    intelligenceScope: string;
    evaluableWeightsSum: number;
    floorCount: number;
    perFloor: Array<{ floorLevel: number; overallQuality: number; quality: Record<string, number | null> }>;
    vertical: { score: number; isConnected: boolean; stairCount: number; disconnectedFloors: number[] };
    stacking: { score: number; kitchenStackingScore: number; bathroomStackingScore: number };
    interFloor: { score: number; floorAccessScore: number; entranceToVerticalScore: number };
    wholeBuilding: { overall: number; floorCount: number; avgFloorQuality: Record<string, number | null> };
  };
  outputs: {
    dxf: { filename: string; insunits: number };
    pdf: { filename: string; sheetSize: string; scale: string };
    xlsx: { filename: string; sheets: string[] };
    report: { filename: string };
    manifest: { filename: string };
  };
  generation: {
    timestamp: string;
    softwareVersion: string;
    schemaVersion: number;
    checksum: string;
    reproducibility: {
      inputHash: string;
      geometryHash: string;
      deterministic: boolean;
    };
  };
  consistency: {
    roomAreas: Record<string, number>;
    totalArea: number;
    checksum: string;
  };
  areaSummary: {
    grossFloorArea: number;
    netUsableArea: number;
    circulationArea: number;
    serviceArea: number;
    parkingArea: number;
    residualArea: number;
    totalRoomArea: number;
    withinTolerance: boolean;
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function buildManifest(docModel: DocumentationModel, project: Project, candidate: LayoutCandidate): ProjectManifest {
  const inputHash = simpleHash(JSON.stringify({ site: docModel.site, building: docModel.building, seed: docModel.generation.seed, strategy: docModel.generation.strategy }));
  const geometryHash = simpleHash(JSON.stringify({ floors: docModel.floors, roomCount: docModel.roomSchedule.length, checksum: docModel.consistency.checksum }));

  return {
    manifestVersion: '1.0.0',
    schemaVersion: DOCUMENTATION_SCHEMA_VERSION,
    project: {
      id: docModel.project.id,
      name: docModel.project.name,
      client: docModel.project.client,
      createdAt: docModel.project.createdAt,
      updatedAt: docModel.project.updatedAt,
    },
    input: {
      site: { width: docModel.site.width, length: docModel.site.length, shape: docModel.site.shape, accessSide: docModel.site.accessSide, area: docModel.site.area, buildableArea: (docModel.site as any).buildableArea, setbacks: (docModel.site as any).setbacks, jurisdiction: (docModel.site as any).jurisdiction, city: (docModel.site as any).city, parkingLayout: (docModel.site as any).parkingLayout, lShape: (docModel.site as any).lShape, polygonVertices: (docModel.site as any).polygonVertices },
      building: {
        type: docModel.building.type,
        floors: docModel.building.floors,
        bedrooms: docModel.building.bedrooms,
        masterBedrooms: docModel.building.masterBedrooms,
        bathrooms: docModel.building.bathrooms,
        wc: docModel.building.wc,
        parkingSpaces: docModel.building.parkingSpaces,
      },
      seed: docModel.generation.seed,
      deterministic: docModel.generation.deterministic,
    },
    geometry: {
      candidateId: candidate.id,
      strategy: candidate.metadata.strategy,
      floors: candidate.floors.length,
      footprint: candidate.floors[0]?.footprint ? { x: candidate.floors[0].footprint.x, y: candidate.floors[0].footprint.y, w: candidate.floors[0].footprint.w, h: candidate.floors[0].footprint.h } : { x: 0, y: 0, w: 0, h: 0 },
      totalSpaces: candidate.floors.reduce((sum, fl) => sum + fl.spaces.length, 0),
      totalWalls: candidate.floors.reduce((sum, fl) => sum + fl.walls.length, 0),
      totalOpenings: candidate.floors.reduce((sum, fl) => sum + fl.openings.length, 0),
      totalStairs: candidate.floors.reduce((sum, fl) => sum + fl.stairs.length, 0),
      siteShape: docModel.site.shape,
      buildableArea: (docModel.site as any).buildableArea ?? 0,
      siteValidation: (docModel.site as any).siteValidation ?? { isValid: true, errors: [] },
    },
    regulation: {
      packs: docModel.generation.regulationPacks,
      verifiedCount: docModel.regulationFindings.filter(f => f.status === 'VERIFIED').length,
      requiresVerificationCount: docModel.regulationFindings.filter(f => f.status === 'REQUIRES_SOURCE_VERIFICATION').length,
      notImplementedCount: docModel.regulationFindings.filter(f => f.status === 'NOT_IMPLEMENTED').length,
    },
    qa: {
      configVersion: docModel.generation.qaConfig.version,
      hardCount: docModel.qaFindings.filter(f => f.severity === 'hard').length,
      softCount: docModel.qaFindings.filter(f => f.severity === 'soft').length,
      advisoryCount: docModel.qaFindings.filter(f => f.severity === 'advisory').length,
      heuristicCount: docModel.qaFindings.filter(f => f.isHeuristic).length,
    },
    intelligence: docModel.intelligence ? {
      feasible: docModel.intelligence.feasible,
      hardViolations: docModel.intelligence.hardViolations,
      overallQuality: docModel.intelligence.overallQuality,
      quality: docModel.intelligence.quality as any,
      strategy: docModel.intelligence.strategy,
      intelligenceScope: docModel.intelligence.intelligenceScope,
      evaluableWeightsSum: (docModel.intelligence.quality as any).evaluableWeightsSum ?? 1,
      floorCount: docModel.intelligence.floorCount,
      perFloor: docModel.intelligence.perFloor.map(pf => ({ floorLevel: pf.floorLevel, overallQuality: pf.overallQuality, quality: pf.quality as any })),
      vertical: { score: docModel.intelligence.vertical.score, isConnected: docModel.intelligence.vertical.isConnected, stairCount: docModel.intelligence.vertical.stairCount, disconnectedFloors: docModel.intelligence.vertical.disconnectedFloors },
      stacking: { score: docModel.intelligence.stacking.score, kitchenStackingScore: docModel.intelligence.stacking.kitchenStackingScore, bathroomStackingScore: docModel.intelligence.stacking.bathroomStackingScore },
      interFloor: { score: docModel.intelligence.interFloor.score, floorAccessScore: docModel.intelligence.interFloor.floorAccessScore, entranceToVerticalScore: docModel.intelligence.interFloor.entranceToVerticalScore },
      wholeBuilding: { overall: docModel.intelligence.wholeBuilding.overall, floorCount: docModel.intelligence.wholeBuilding.floorCount, avgFloorQuality: docModel.intelligence.wholeBuilding.avgFloorQuality as any },
    } : undefined,
    outputs: {
      dxf: { filename: docModel.outputs.dxf.filename, insunits: docModel.outputs.dxf.insunits },
      pdf: { filename: docModel.outputs.pdf.filename, sheetSize: docModel.outputs.pdf.sheetSize, scale: docModel.outputs.pdf.scale },
      xlsx: { filename: docModel.outputs.xlsx.filename, sheets: docModel.outputs.xlsx.sheets },
      report: { filename: docModel.outputs.report.filename },
      manifest: { filename: docModel.outputs.manifest.filename },
    },
    generation: {
      timestamp: docModel.generation.timestamp,
      softwareVersion: SOFTWARE_VERSION,
      schemaVersion: docModel.generation.schemaVersion,
      checksum: docModel.consistency.checksum,
      reproducibility: {
        inputHash,
        geometryHash,
        deterministic: true,
      },
    },
    consistency: docModel.consistency,
    areaSummary: {
      grossFloorArea: docModel.areaSummary.grossFloorArea,
      netUsableArea: docModel.areaSummary.netUsableArea,
      circulationArea: docModel.areaSummary.circulationArea,
      serviceArea: docModel.areaSummary.serviceArea,
      parkingArea: docModel.areaSummary.parkingArea,
      residualArea: docModel.areaSummary.residualArea,
      totalRoomArea: docModel.areaSummary.totalRoomArea,
      withinTolerance: docModel.areaSummary.reconciliation.grossVsComponents.withinTolerance,
    },
  };
}

export function validateManifest(manifest: ProjectManifest): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.manifestVersion) errors.push('Missing manifestVersion');
  if (!manifest.project.id) errors.push('Missing project.id');
  if (!manifest.input.site.width) errors.push('Missing input.site.width');
  if (!manifest.geometry.candidateId) errors.push('Missing geometry.candidateId');
  if (!manifest.generation.timestamp) errors.push('Missing generation.timestamp');
  if (!manifest.consistency.checksum) errors.push('Missing consistency.checksum');
  if (!manifest.generation.reproducibility.deterministic) errors.push('Not deterministic');
  return { ok: errors.length === 0, errors };
}
