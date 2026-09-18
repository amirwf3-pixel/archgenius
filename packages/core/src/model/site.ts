/**
 * Site input model.
 *
 * V1 only supports rectangular sites; shape is constrained to 'rectangle'.
 * Future phases may add 'polygon' / 'l-shape' / etc.
 */

export type SiteShape = 'rectangle';

/** Which side of the site fronts the access street. */
export type AccessSide = 'south' | 'north' | 'east' | 'west';

export interface SiteInput {
  /** Site shape. V1: only 'rectangle'. */
  shape: SiteShape;
  /** Site width (East extent), in meters. */
  width: number;
  /** Site length (North extent), in meters. */
  length: number;
  /**
   * Rotation of site +Y relative to true North, in degrees clockwise.
   * 0   = +Y points true North (default).
   * 90  = +Y points East.
   * Internal geometry always treats +Y as "plan north" — true-north rotation
   * is applied only at render/export time.
   */
  northRotationDeg?: number;
  /** Side of the site with street frontage / vehicle access. */
  accessSide: AccessSide;
  /** Width of the adjacent street (meters) — used for entrance & parking design. */
  streetWidth?: number;
  /** Optional site area override (meters²). If omitted, computed from shape. */
  area?: number;
  /** Optional: setback overrides in meters; otherwise from regulation pack. */
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
}

export interface Site extends SiteInput {
  /** Computed area (m²). */
  readonly area: number;
  /** North rotation used (radians, CCW from +X = East for rendering). Default 0. */
  readonly northRotation: number;
}
