/**
 * Phase 10 — Canonical Buildable Geometry
 *
 * Computes buildable boundary from site boundary + setbacks.
 * Distinguishes original site boundary, applied setbacks, buildable boundary, area, bounding rect, source/status.
 * Preserves Rect footprint compatibility but canonical buildable geometry is polygon used for placement/validation.
 */

import type { SiteInput } from '../model/site.js';
import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon-ops.js';
import {
  polygonArea,
  polygonBoundingRect,
  createLShapePolygon,
  validateSitePolygon,
  insetOrthogonalPolygon,
  isOrthogonal,
  hasSelfIntersection,
  hasDuplicateConsecutiveVertices,
  hasZeroLengthEdges,
  pointInPolygon,
  rectInsidePolygon,
  decomposeOrthogonalPolygonToRects,
} from '../geometry/polygon-ops.js';
import { rArea, rInset } from '../geometry/rect.js';
import { EPS } from '../units.js';

export interface AppliedSetback {
  direction: 'north' | 'south' | 'east' | 'west';
  value: number;
  source: 'user-defined' | 'default-assumption' | 'verified';
  status: 'VERIFIED' | 'REQUIRES_SOURCE_VERIFICATION' | 'USER_DEFINED' | 'DEFAULT';
  reference?: string;
}

export interface BuildableGeometry {
  /** Original site boundary polygon (CCW) */
  siteBoundary: Polygon;
  /** Site area m² */
  siteArea: number;
  /** Site bounding rect */
  siteBoundingRect: Rect;
  /** Applied setbacks with source/status */
  appliedSetbacks: AppliedSetback[];
  /** Buildable boundary polygon (CCW) — canonical for placement/validation */
  buildableBoundary: Polygon;
  /** Buildable area m² */
  buildableArea: number;
  /** Buildable bounding rect */
  buildableBoundingRect: Rect;
  /** Legacy buildable rect for backward compat (bounding rect inset) */
  buildableRect: Rect;
  /** Buildable rects decomposition for L-shape/polygon (for placement) */
  buildableRects: Rect[];
  /** Validation */
  isValid: boolean;
  validationErrors: string[];
  /** Source description */
  source: string;
}

const DEFAULT_SETBACKS = { north: 3.0, south: 2.0, east: 2.0, west: 2.0 };
const STREET_SETBACK = 1.5;
const MIN_BUILDABLE_AREA = 5; // m²

export function computeBuildableGeometry(input: SiteInput): BuildableGeometry {
  const errors: string[] = [];

  // Resolve setbacks: support both new setbackNorth/etc and legacy setbacks object {north,south,east,west}
  const legacySetbacks = (input as any).setbacks as { north?: number; south?: number; east?: number; west?: number } | undefined;
  const setbacks = {
    north: input.setbackNorth ?? legacySetbacks?.north ?? DEFAULT_SETBACKS.north,
    south: input.setbackSouth ?? legacySetbacks?.south ?? DEFAULT_SETBACKS.south,
    east: input.setbackEast ?? legacySetbacks?.east ?? DEFAULT_SETBACKS.east,
    west: input.setbackWest ?? legacySetbacks?.west ?? DEFAULT_SETBACKS.west,
  };
  const access = input.accessSide;
  let setbackSources: Record<string, AppliedSetback['source']> = {
    north: (input.setbackNorth !== undefined || legacySetbacks?.north !== undefined) ? 'user-defined' : 'default-assumption',
    south: (input.setbackSouth !== undefined || legacySetbacks?.south !== undefined) ? 'user-defined' : 'default-assumption',
    east: (input.setbackEast !== undefined || legacySetbacks?.east !== undefined) ? 'user-defined' : 'default-assumption',
    west: (input.setbackWest !== undefined || legacySetbacks?.west !== undefined) ? 'user-defined' : 'default-assumption',
  };
  let setbackStatuses: Record<string, AppliedSetback['status']> = {
    north: (input.setbackNorth !== undefined || legacySetbacks?.north !== undefined) ? 'USER_DEFINED' : 'DEFAULT',
    south: (input.setbackSouth !== undefined || legacySetbacks?.south !== undefined) ? 'USER_DEFINED' : 'DEFAULT',
    east: (input.setbackEast !== undefined || legacySetbacks?.east !== undefined) ? 'USER_DEFINED' : 'DEFAULT',
    west: (input.setbackWest !== undefined || legacySetbacks?.west !== undefined) ? 'USER_DEFINED' : 'DEFAULT',
  };

  // Apply street-side reduction if user didn't override (check both new and legacy)
  if (input.setbackNorth === undefined && legacySetbacks?.north === undefined && access === 'north') {
    setbacks.north = STREET_SETBACK;
    setbackSources.north = 'default-assumption';
    setbackStatuses.north = 'DEFAULT';
  }
  if (input.setbackSouth === undefined && legacySetbacks?.south === undefined && access === 'south') {
    setbacks.south = STREET_SETBACK;
    setbackSources.south = 'default-assumption';
    setbackStatuses.south = 'DEFAULT';
  }
  if (input.setbackEast === undefined && legacySetbacks?.east === undefined && access === 'east') {
    setbacks.east = STREET_SETBACK;
    setbackSources.east = 'default-assumption';
    setbackStatuses.east = 'DEFAULT';
  }
  if (input.setbackWest === undefined && legacySetbacks?.west === undefined && access === 'west') {
    setbacks.west = STREET_SETBACK;
    setbackSources.west = 'default-assumption';
    setbackStatuses.west = 'DEFAULT';
  }

  const appliedSetbacks: AppliedSetback[] = [
    { direction: 'north', value: setbacks.north, source: setbackSources.north, status: setbackStatuses.north as any, reference: setbackSources.north === 'user-defined' ? 'User-defined design input — NOT a legal requirement' : 'Default assumption — REQUIRES_SOURCE_VERIFICATION' },
    { direction: 'south', value: setbacks.south, source: setbackSources.south, status: setbackStatuses.south as any, reference: setbackSources.south === 'user-defined' ? 'User-defined design input — NOT a legal requirement' : 'Default assumption — REQUIRES_SOURCE_VERIFICATION' },
    { direction: 'east', value: setbacks.east, source: setbackSources.east, status: setbackStatuses.east as any, reference: setbackSources.east === 'user-defined' ? 'User-defined design input — NOT a legal requirement' : 'Default assumption — REQUIRES_SOURCE_VERIFICATION' },
    { direction: 'west', value: setbacks.west, source: setbackSources.west, status: setbackStatuses.west as any, reference: setbackSources.west === 'user-defined' ? 'User-defined design input — NOT a legal requirement' : 'Default assumption — REQUIRES_SOURCE_VERIFICATION' },
  ];

  let siteBoundary: Polygon;
  let siteArea: number;
  let siteBoundingRect: Rect;

  // Build site boundary based on shape
  if (input.shape === 'rectangle') {
    const w = input.width;
    const h = input.length;
    siteBoundary = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    siteArea = w * h;
    siteBoundingRect = { x: 0, y: 0, w, h };
  } else if (input.shape === 'l-shape') {
    const ls = input.lShape;
    if (!ls) {
      errors.push('l-shape input required for shape l-shape');
      siteBoundary = [
        { x: 0, y: 0 },
        { x: input.width, y: 0 },
        { x: input.width, y: input.length },
        { x: 0, y: input.length },
      ];
      siteArea = input.width * input.length;
      siteBoundingRect = { x: 0, y: 0, w: input.width, h: input.length };
    } else {
      // Validate L-shape params
      if (ls.width <= 2 || ls.length <= 2) errors.push('l-shape width/length must be >2');
      if (ls.notchWidth <= 0 || ls.notchLength <= 0) errors.push('l-shape notch dimensions must be >0');
      if (ls.notchWidth >= ls.width) errors.push('l-shape notchWidth must be < width');
      if (ls.notchLength >= ls.length) errors.push('l-shape notchLength must be < length');
      siteBoundary = createLShapePolygon(ls.width, ls.length, ls.notchWidth, ls.notchLength, ls.notchCorner, 0, 0);
      siteArea = polygonArea(siteBoundary);
      siteBoundingRect = polygonBoundingRect(siteBoundary);
    }
  } else if (input.shape === 'polygon') {
    const polyInput = input.polygon;
    if (!polyInput || !polyInput.vertices || polyInput.vertices.length < 3) {
      errors.push('polygon vertices required for shape polygon (3..8)');
      siteBoundary = [
        { x: 0, y: 0 },
        { x: input.width, y: 0 },
        { x: input.width, y: input.length },
        { x: 0, y: input.length },
      ];
      siteArea = input.width * input.length;
      siteBoundingRect = { x: 0, y: 0, w: input.width, h: input.length };
    } else {
      const verts = polyInput.vertices.map(v => ({ x: v.x, y: v.y }));
      const validation = validateSitePolygon(verts, 8, 10);
      if (!validation.valid) {
        errors.push(...validation.errors);
      }
      siteBoundary = verts;
      siteArea = validation.area;
      siteBoundingRect = polygonBoundingRect(siteBoundary);
    }
  } else {
    errors.push(`unsupported site shape ${input.shape}`);
    siteBoundary = [
      { x: 0, y: 0 },
      { x: input.width, y: 0 },
      { x: input.width, y: input.length },
      { x: 0, y: input.length },
    ];
    siteArea = input.width * input.length;
    siteBoundingRect = { x: 0, y: 0, w: input.width, h: input.length };
  }

  // Compute buildable boundary via inset
  let buildableBoundary: Polygon;
  let buildableArea: number;
  let buildableBoundingRect: Rect;
  let buildableRect: Rect;
  let buildableRects: Rect[] = [];

  if (input.shape === 'rectangle') {
    // Use existing rect inset logic for backward compat, but also produce polygon
    const rect: Rect = { x: siteBoundingRect.x, y: siteBoundingRect.y, w: siteBoundingRect.w, h: siteBoundingRect.h };
    // Apply setbacks per side
    const insetRect: Rect = {
      x: rect.x + setbacks.west,
      y: rect.y + setbacks.south,
      w: Math.max(0.1, rect.w - setbacks.west - setbacks.east),
      h: Math.max(0.1, rect.h - setbacks.south - setbacks.north),
    };
    // Detect consumed by setbacks
    if (rect.w - setbacks.west - setbacks.east <= 0.1 || rect.h - setbacks.south - setbacks.north <= 0.1) {
      errors.push(`buildable area consumed by setbacks: site ${rect.w}x${rect.h} setbacks N${setbacks.north} S${setbacks.south} E${setbacks.east} W${setbacks.west}`);
    }
    buildableRect = insetRect;
    buildableBoundary = [
      { x: insetRect.x, y: insetRect.y },
      { x: insetRect.x + insetRect.w, y: insetRect.y },
      { x: insetRect.x + insetRect.w, y: insetRect.y + insetRect.h },
      { x: insetRect.x, y: insetRect.y + insetRect.h },
    ];
    buildableArea = rArea(insetRect);
    buildableBoundingRect = insetRect;
    buildableRects = [insetRect];
    if (buildableArea < MIN_BUILDABLE_AREA) {
      errors.push(`insufficient buildable area ${buildableArea.toFixed(2)} < ${MIN_BUILDABLE_AREA} after setbacks`);
    }
  } else {
    // L-shape or polygon — use orthogonal inset
    const insetResult = insetOrthogonalPolygon(siteBoundary, setbacks);
    if (!insetResult) {
      errors.push('buildable geometry: inset failed — non-orthogonal or invalid site polygon for V1');
      // Fallback to bounding rect inset for placement (but mark invalid)
      const br = siteBoundingRect;
      const fallbackRect: Rect = {
        x: br.x + setbacks.west,
        y: br.y + setbacks.south,
        w: Math.max(0.1, br.w - setbacks.west - setbacks.east),
        h: Math.max(0.1, br.h - setbacks.south - setbacks.north),
      };
      buildableBoundary = [
        { x: fallbackRect.x, y: fallbackRect.y },
        { x: fallbackRect.x + fallbackRect.w, y: fallbackRect.y },
        { x: fallbackRect.x + fallbackRect.w, y: fallbackRect.y + fallbackRect.h },
        { x: fallbackRect.x, y: fallbackRect.y + fallbackRect.h },
      ];
      buildableArea = rArea(fallbackRect);
      buildableBoundingRect = fallbackRect;
      buildableRect = fallbackRect;
      buildableRects = [fallbackRect];
    } else {
      if (insetResult.errors.length > 0) {
        errors.push(...insetResult.errors.map(e => `buildable: ${e}`));
      }
      buildableBoundary = insetResult.polygon;
      buildableArea = polygonArea(buildableBoundary);
      buildableBoundingRect = polygonBoundingRect(buildableBoundary);
      // For backward compat, buildableRect is bounding rect of buildableBoundary — compatibility/presentation only
      buildableRect = buildableBoundingRect;
      // Decompose into rects for placement — canonical geometry, no silent bbox fallback
      try {
        const decomposed = decomposeOrthogonalPolygonToRects(buildableBoundary);
        if (!decomposed || decomposed.length === 0) {
          errors.push(`buildable decomposition failure for ${buildableBoundary.length}-vertex polygon — cannot decompose safely into rectangles (bounded failure, no bbox fallback as canonical)`);
          buildableRects = []; // empty signals failure, not bbox
        } else {
          buildableRects = decomposed;
        }
      } catch (e: any) {
        errors.push(`buildable decomposition exception: ${e?.message ?? e} — bounded failure, no bbox fallback`);
        buildableRects = [];
      }
      if (buildableArea < MIN_BUILDABLE_AREA) {
        errors.push(`insufficient buildable area ${buildableArea.toFixed(2)} < ${MIN_BUILDABLE_AREA} after setbacks`);
      }
    }
  }

  const isValid = errors.length === 0 && buildableArea >= MIN_BUILDABLE_AREA;

  return {
    siteBoundary,
    siteArea,
    siteBoundingRect,
    appliedSetbacks,
    buildableBoundary,
    buildableArea,
    buildableBoundingRect,
    buildableRect,
    buildableRects,
    isValid,
    validationErrors: errors,
    source: `Site shape ${input.shape}, setbacks N=${setbacks.north} S=${setbacks.south} E=${setbacks.east} W=${setbacks.west} — ${appliedSetbacks.map(s => `${s.direction}:${s.source}`).join(', ')}`,
  };
}
