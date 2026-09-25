/**
 * Regulation engine: composes packs and computes buildable-area setbacks
 * and other parameters.
 *
 * IMPORTANT: V1 ships with SANE DEFAULTS plus the Iranian national Mabhas
 * pack. Any rule that we do not have a confirmed primary source for is
 * flagged with `REQUIRES_SOURCE_VERIFICATION` and exposed in reports.
 *
 * See ../../docs/regulation-engine.md for the rule inventory and sources.
 */
import type { ProjectInput } from '../model/project.js';
import type { RegulationPack, BuildableFootprint, RegulationRule, RuleContext, RuleResult, SourceTier } from './types.js';
import type { AccessSide } from '../model/site.js';
import { IR_NATIONAL_MBR_PACK, IR_TEHRAN_STUB_PACK } from './packs/ir-national-mbr.js';
import { selectPacks } from './pack-registry.js';
import { resolveMunicipality } from './municipality.js';
import { MUNICIPAL_STUB_PACKS } from './packs/ir-municipal-stubs.js';
import { computeBuildableGeometry } from '../site/buildable.js';

/**
 * Default setbacks used when no local pack is loaded. These are TYPICAL values
 * seen across many Iranian municipalities for low-rise residential
 * buildings in typical residential zones. They are NOT a substitute for
 * the detailed plan (tarh tafsili) of the specific parcel.
 *
 * All values are in meters. Each is marked REQUIRES_SOURCE_VERIFICATION.
 */
const DEFAULT_SETBACKS = {
  north: 3.0,
  south: 2.0,
  east: 2.0,
  west: 2.0,
};

/** For parcels with street access on a side, setback on that side is typically reduced. */
const STREET_SETBACK = 1.5; // from street edge (façade)

export function buildDefaultPack(): RegulationPack {
  const r = (
    ruleId: string,
    title: string,
    category: RegulationRule['category'],
    severity: RegulationRule['severity'],
    evaluate: RegulationRule['evaluate'],
    params?: Record<string, number | string | boolean>,
  ): RegulationRule => ({
    ruleId,
    jurisdiction: 'ir-default',
    scope: 'local',
    title,
    edition: 'draft-v0.1',
    status: 'REQUIRES_SOURCE_VERIFICATION',
    sourceTier: 3,
    category,
    severity,
    params,
    reference: 'DEFAULT ASSUMPTION — REQUIRES MUNICIPAL VERIFICATION',
    family: 'default-assumption',
    evaluate,
  });

  return {
    id: 'ir-default-v0.1',
    jurisdiction: 'unknown-iranian-municipality',
    scope: 'default',
    edition: 'draft-v0.1',
    description:
      'Default assumption pack. These setbacks/parking values are typical low-rise ' +
      'residential defaults used for layout generation when a verified municipality ' +
      'pack is not available. MUST be verified against the local detailed plan.',
    sourceRegistry: [
      {
        id: 'default-engineering-assumption',
        title: 'Engineering defaults — NOT a legal source',
        jurisdiction: 'default',
        tier: 3,
        verificationState: 'not-obtained',
        note: 'These values are engineering heuristics; no regulatory document supports them.',
      },
    ],
    rules: [
      r('DEF-SETBACK-001', 'Default perimeter setbacks', 'setback', 'advisory',
        () => ({ pass: true, severity: 'advisory' as const, code: 'DEF-SETBACK-001', message: 'Using default assumed setbacks; verify against municipal detailed plan.', reference: 'DEFAULT ASSUMPTION', status: 'REQUIRES_SOURCE_VERIFICATION' as const })),
      r('DEF-PARK-001', 'Default parking 1 stall per unit', 'parking', 'soft',
        (ctx) => {
          const units = (ctx.project.building.unitsPerFloor ?? 1) * Math.max(1, ctx.project.building.floors);
          const req = units;
          const provided = ctx.project.building.parkingSpaces ?? 0;
          if (provided >= req) return [];
          return [{
            pass: false,
            severity: 'soft' as const,
            code: 'DEF-PARK-001',
            message: `Parking ${provided}/${req} stalls (default assumption: 1 stall per residential unit — verify with municipality).`,
            value: req,
            reference: 'DEFAULT ASSUMPTION',
            status: 'REQUIRES_SOURCE_VERIFICATION' as const,
          }];
        }),
    ],
  };
}

/**
 * Select which jurisdiction packs to load based on project input.
 *
 * Default behaviour (no `regulationPacks` / `regulationPackEditions` on the
 * input) is unchanged: default assumption pack + national Mabhas pack + the
 * local placeholder. An explicit selection or edition pin is resolved through
 * the pack registry (`./pack-registry.ts`), which refuses unknown packs,
 * unknown editions, and editions whose primary source is not in `sources/`.
 */
export function composePacks(project: ProjectInput): RegulationPack[] {
  const packs: RegulationPack[] = [buildDefaultPack()];
  const country = (project.country ?? 'ir').toLowerCase();
  if (country === 'ir' || country === 'iran') {
    packs.push(IR_NATIONAL_MBR_PACK);
    // Local stub (will be replaced by real municipality pack once primary
    // sources are provided); always added so UI can surface the "local
    // verification required" advisory.
    // ROADMAP.md:46: a recognised non-Tehran municipality receives ITS OWN
    // placeholder pack (never Tehran's). Tehran, no municipality, and
    // unrecognised/ambiguous input keep the pre-existing Tehran placeholder —
    // unchanged behaviour (golden outputs depend on it).
    const municipality = resolveMunicipality(project);
    if (municipality && municipality !== 'tehran') {
      packs.push(MUNICIPAL_STUB_PACKS[municipality]);
    } else {
      packs.push(IR_TEHRAN_STUB_PACK);
    }
  }
  return selectPacks(packs, project.regulationPacks, project.regulationPackEditions);
}

/** Compute buildable footprint from site + packs — Phase 10 canonical geometry. */
export function computeBuildableArea(project: ProjectInput): BuildableFootprint {
  // Phase 10 — use canonical buildable geometry
  try {
    const geom = computeBuildableGeometry(project.site);
    const setbacks = {
      north: project.site.setbackNorth ?? DEFAULT_SETBACKS.north,
      south: project.site.setbackSouth ?? DEFAULT_SETBACKS.south,
      east: project.site.setbackEast ?? DEFAULT_SETBACKS.east,
      west: project.site.setbackWest ?? DEFAULT_SETBACKS.west,
    };
    const access: AccessSide = project.site.accessSide;
    if (project.site.setbackNorth === undefined && access === 'north') setbacks.north = STREET_SETBACK;
    if (project.site.setbackSouth === undefined && access === 'south') setbacks.south = STREET_SETBACK;
    if (project.site.setbackEast === undefined && access === 'east') setbacks.east = STREET_SETBACK;
    if (project.site.setbackWest === undefined && access === 'west') setbacks.west = STREET_SETBACK;

    return {
      setbacks,
      rect: geom.buildableRect,
      appliedRules: [
        {
          ruleId: 'DEF-SETBACK-001',
          reference: geom.appliedSetbacks.map((s: any) => `${s.direction}=${s.value}m ${s.source}`).join(', ') + ' — ' + geom.source,
          message: `Applied setbacks N=${setbacks.north} S=${setbacks.south} E=${setbacks.east} W=${setbacks.west} m. Site shape ${project.site.shape}, siteArea ${geom.siteArea.toFixed(1)} m², buildableArea ${geom.buildableArea.toFixed(1)} m². ${geom.validationErrors.length ? 'Errors: ' + geom.validationErrors.join('; ') : ''}`,
          status: 'REQUIRES_SOURCE_VERIFICATION',
        },
      ],
      requiresSourceVerification: geom.appliedSetbacks.some((s: any) => s.source !== 'verified'),
      siteBoundary: geom.siteBoundary,
      siteArea: geom.siteArea,
      siteBoundingRect: geom.siteBoundingRect,
      buildableBoundary: geom.buildableBoundary,
      buildableArea: geom.buildableArea,
      buildableBoundingRect: geom.buildableBoundingRect,
      buildableRects: geom.buildableRects,
      appliedSetbacks: geom.appliedSetbacks,
      buildableValid: geom.isValid,
      buildableErrors: geom.validationErrors,
      siteShape: project.site.shape,
    };
  } catch (e) {
    // Fallback to old rect logic if new module fails
    const site = project.site;
    const setbacks = {
      north: site.setbackNorth ?? DEFAULT_SETBACKS.north,
      south: site.setbackSouth ?? DEFAULT_SETBACKS.south,
      east: site.setbackEast ?? DEFAULT_SETBACKS.east,
      west: site.setbackWest ?? DEFAULT_SETBACKS.west,
    };
    const access: AccessSide = site.accessSide;
    if (site.setbackNorth === undefined && access === 'north') setbacks.north = STREET_SETBACK;
    if (site.setbackSouth === undefined && access === 'south') setbacks.south = STREET_SETBACK;
    if (site.setbackEast === undefined && access === 'east') setbacks.east = STREET_SETBACK;
    if (site.setbackWest === undefined && access === 'west') setbacks.west = STREET_SETBACK;

    const rect = {
      x: setbacks.west,
      y: setbacks.south,
      w: Math.max(0.1, site.width - setbacks.west - setbacks.east),
      h: Math.max(0.1, site.length - setbacks.south - setbacks.north),
    };

    return {
      setbacks,
      rect,
      appliedRules: [
        {
          ruleId: 'DEF-SETBACK-001',
          reference: 'Default assumption pack (fallback)',
          message: `Applied assumed setbacks N=${setbacks.north} S=${setbacks.south} E=${setbacks.east} W=${setbacks.west} m. Fallback due to error: ${String(e)}`,
          status: 'REQUIRES_SOURCE_VERIFICATION',
        },
      ],
      requiresSourceVerification: true,
      siteBoundary: [
        { x: 0, y: 0 },
        { x: site.width, y: 0 },
        { x: site.width, y: site.length },
        { x: 0, y: site.length },
      ],
      siteArea: site.width * site.length,
      siteBoundingRect: { x: 0, y: 0, w: site.width, h: site.length },
      buildableBoundary: [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h },
      ],
      buildableArea: rect.w * rect.h,
      buildableBoundingRect: rect,
      buildableRects: [rect],
      appliedSetbacks: [
        { direction: 'north', value: setbacks.north, source: 'default-assumption', status: 'DEFAULT', reference: 'Fallback' },
        { direction: 'south', value: setbacks.south, source: 'default-assumption', status: 'DEFAULT', reference: 'Fallback' },
        { direction: 'east', value: setbacks.east, source: 'default-assumption', status: 'DEFAULT', reference: 'Fallback' },
        { direction: 'west', value: setbacks.west, source: 'default-assumption', status: 'DEFAULT', reference: 'Fallback' },
      ],
      buildableValid: true,
      buildableErrors: [],
      siteShape: site.shape,
    };
  }
}

export function runPackRules(packs: RegulationPack[], project: ProjectInput, footprint: BuildableFootprint): RuleResult[] {
  const ctx: RuleContext = {
    project,
    footprint: footprint.rect,
    siteWidth: project.site.width,
    siteLength: project.site.length,
    siteArea: project.site.area ?? project.site.width * project.site.length,
  };
  return runPacksWithContext(packs, ctx);
}

/**
 * Evaluate pack rules against a generated layout candidate (post-generation).
 * These are checks that need floor/space geometry (room dimensions, stairs, etc.).
 */
import type { LayoutCandidate } from '../model/layout.js';
export function runPackRulesOnCandidate(packs: RegulationPack[], project: ProjectInput, footprint: BuildableFootprint, candidate: LayoutCandidate): RuleResult[] {
  const ctx: RuleContext = {
    project,
    footprint: footprint.rect,
    siteWidth: project.site.width,
    siteLength: project.site.length,
    siteArea: project.site.area ?? project.site.width * project.site.length,
    candidate,
  };
  return runPacksWithContext(packs, ctx);
}

function runPacksWithContext(packs: RegulationPack[], ctx: RuleContext): RuleResult[] {
  const out: RuleResult[] = [];
  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (rule.status === 'NOT_IMPLEMENTED') {
        out.push({
          pass: true,
          severity: 'advisory',
          code: rule.ruleId,
          message: `Rule "${rule.title}" is marked NOT_IMPLEMENTED. ${pack.description ?? ''}`,
          reference: rule.reference,
          status: 'NOT_IMPLEMENTED',
        });
        continue;
      }
      if (!rule.evaluate) continue;
      try {
        const r = rule.evaluate(ctx);
        const arr = Array.isArray(r) ? r : [r];
        for (const one of arr) {
          // Stamp the rule metadata onto the result so reports are traceable.
          if (!one.reference) one.reference = rule.reference;
          if (!one.status) one.status = rule.status;
          if (!one.sources && rule.sources) one.sources = rule.sources;
          out.push(one);
        }
      } catch (e: any) {
        out.push({
          pass: false,
          severity: 'advisory',
          code: rule.ruleId,
          message: `Rule evaluator threw: ${e?.message ?? e}`,
          reference: rule.reference,
          status: rule.status,
        });
      }
    }
  }
  return out;
}
