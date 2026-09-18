/**
 * Site input model — Phase 10 Site/Context Intelligence & Buildability
 *
 * Supports rectangle, l-shape, and simple orthogonal polygon sites.
 * All shapes are validated deterministically, bounded, no self-intersection.
 */

export type SiteShape = 'rectangle' | 'l-shape' | 'polygon';

/** Which side of the site fronts the access street. */
export type AccessSide = 'south' | 'north' | 'east' | 'west';

/** L-shape definition via overall bounding box minus a corner notch (orthogonal, 6 vertices). */
export interface LShapeInput {
  /** Overall width (East extent) of bounding box, m */
  width: number;
  /** Overall length (North extent) of bounding box, m */
  length: number;
  /** Notch width (missing width), m — must be < width */
  notchWidth: number;
  /** Notch length (missing length), m — must be < length */
  notchLength: number;
  /** Corner where notch is removed */
  notchCorner: 'ne' | 'nw' | 'se' | 'sw';
}

/** Simple polygon site — orthogonal for V1, 3..8 vertices */
export interface PolygonSiteInput {
  /** Vertices in order (CW or CCW), deterministic, simple, no self-intersection */
  vertices: Array<{ x: number; y: number }>;
}

export interface SiteInput {
  /** Site shape. */
  shape: SiteShape;
  /** Site width (East extent), in meters — for rectangle and l-shape overall. */
  width: number;
  /** Site length (North extent), in meters — for rectangle and l-shape overall. */
  length: number;
  /**
   * Rotation of site +Y relative to true North, in degrees clockwise.
   * 0   = +Y points true North (default).
   */
  northRotationDeg?: number;
  /** Side of the site with street frontage / vehicle access. */
  accessSide: AccessSide;
  /** Width of the adjacent street (meters) — used for entrance & parking design. */
  streetWidth?: number;
  /** Optional site area override (meters²). If omitted, computed from shape. */
  area?: number;
  /** Optional: setback overrides in meters; otherwise from regulation pack.
   *  These are USER-DEFINED DESIGN INPUTS, not verified legal requirements,
   *  unless backed by Tier-1 source via regulation pack.
   */
  setbackNorth?: number;
  setbackSouth?: number;
  setbackEast?: number;
  setbackWest?: number;
  /** Municipality / jurisdiction identifier (e.g. "tehran", "karaj"). */
  jurisdiction?: string;
  /** City / municipality display name (e.g. "Tehran", "Karaj"). */
  city?: string;
  /** Zoning / detailed-plan identifier if applicable. */
  zoning?: string;

  /** L-shape specific — required when shape === 'l-shape' */
  lShape?: LShapeInput;
  /** Polygon specific — required when shape === 'polygon' */
  polygon?: PolygonSiteInput;

  /** Parking layout preference */
  parkingLayout?: 'perpendicular' | 'parallel' | 'auto';
}

export interface Site extends SiteInput {
  /** Computed area (m²). */
  readonly area: number;
  /** North rotation used (radians, CCW from +X = East for rendering). Default 0. */
  readonly northRotation: number;
}

export const SITE_SHAPE_MAX_VERTICES = 8;
export const SITE_SHAPE_MIN_VERTICES = 3;
export const SITE_MIN_AREA = 10; // m²
