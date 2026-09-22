/**
 * Validation types & finding categories.
 */

export type Severity = 'hard' | 'soft' | 'advisory';

export type FindingCode =
  // ---- Geometric ----
  | 'GEO_OVERLAPPING_ROOMS'
  | 'GEO_OVERLAPPING_WALLS'
  | 'GEO_SELF_INTERSECTION'
  | 'GEO_ZERO_AREA_SPACE'
  | 'GEO_INVALID_DIMENSION'
  | 'GEO_INVALID_COORDINATE'
  | 'GEO_DUPLICATE_GEOMETRY'
  | 'GEO_INCONSISTENT_AREA'
  | 'GEO_ROOM_OUTSIDE_FOOTPRINT'
  // ---- Openings ----
  | 'OPENING_DOOR_COLLISION'
  | 'OPENING_WINDOW_COLLISION'
  | 'OPENING_DOOR_SWING_BLOCKED'
  | 'OPENING_INVALID_WALL'
  // ---- Circulation ----
  | 'CIRC_INACCESSIBLE_SPACE'
  | 'CIRC_DISCONNECTED'
  | 'CIRC_CORRIDOR_TOO_NARROW'
  | 'CIRC_STAIR_OBSTRUCTED'
  | 'CIRC_ROOM_THROUGH_ROOM'
  | 'CIRC_REDUNDANT_DOOR'
  | 'CIRC_INVALID_ENTRY'
  | 'NO_STREET_ENTRANCE'
  | 'CIRC_EXCESSIVE_PATH'
  | 'CIRC_VERTICAL_DISCONNECTED'
  // ---- Program ----
  | 'PROG_MISSING_SPACE'
  | 'PROG_ROOM_TOO_SMALL'
  | 'PROG_ROOM_TOO_NARROW'
  // ---- Parking ----
  | 'PARK_BLOCKED_ACCESS'
  | 'PARK_INFEASIBLE_STALL'
  | 'PARK_AISLE_TOO_NARROW'
  // ---- Regulation ----
  | 'REG_SETBACK_VIOLATION'
  | 'REG_COVERAGE_VIOLATION'
  | 'REG_HEIGHT_VIOLATION'
  | 'REG_PARKING_SHORTFALL'
  | 'REG_RULE_UNVERIFIED'
  // ---- Architectural QA ----
  | 'ARCH_ADJACENCY_VIOLATION'
  | 'ARCH_DAYLIGHT_MISSING'
  | 'ARCH_PRIVACY_VIOLATION'
  | 'ARCH_ORIENTATION_MISSING'
  // ---- Furniture / usability ----
  | 'FURN_OUTSIDE_ROOM'
  | 'FURN_COLLISION'
  | 'FURN_CLEARANCE_BLOCKED'
  | 'FURN_ON_STAIR'
  | 'FURN_ON_LANDING'
  | 'FURN_BLOCKS_STAIR_ACCESS'
  | 'FURNITURE_BLOCKS_DOOR'
  | 'FURNITURE_BLOCKS'
  // ---- Architectural QA Phase 6 ----
  | 'ROOM_UNUSABLE'
  | 'ROOM_TOO_NARROW'
  | 'ROOM_BAD_PROPORTION'
  | 'ROOM_INACCESSIBLE'
  | 'CIRCULATION_DEAD_END'
  | 'CIRCULATION_EXCESSIVE'
  | 'DOOR_COLLISION'
  | 'DOOR_SWING_CONFLICT'
  | 'WINDOW_COLLISION'
  | 'WINDOW_OUTSIDE'
  | 'WINDOW_DOOR_CONFLICT'
  | 'PARKING_ACCESS_BLOCKED'
  | 'SERVICE_EXPOSURE'
  | 'PRIVACY_WEAK'
  | 'EXCESSIVE_RESIDUAL'
  // ---- Stair ----
  | 'STAIR_ZERO_AREA'
  | 'STAIR_INVALID_RISER_COUNT'
  | 'STAIR_INVALID_TREAD_COUNT'
  | 'STAIR_INVALID_RUN'
  | 'STAIR_RISE_MISMATCH'
  | 'STAIR_FLIGHT_TOO_LONG'
  | 'STAIR_FLIGHT_OVER_MAX_RISERS'
  | 'STAIR_MISSING_LANDING'
  | 'STAIR_LANDING_COLLISION'
  | 'STAIR_FLIGHT_COLLISION'
  | 'STAIR_DISCONNECTED'
  | 'STAIR_ACCESS_BLOCKED'
  | 'STAIR_OUTSIDE_BUILDING'
  | 'STAIR_SELF_INTERSECTION'
  | 'STAIR_NARROW_WIDTH'
  | 'STAIR_MISSING'
  | 'STAIR_CORE_MISALIGNED'
  | 'NO_FEASIBLE_STAIR_CONFIGURATION';

import type { RuleStatus, SourceRef } from '../regulations/types.js';

export interface Finding {
  code: FindingCode | string;
  severity: Severity;
  message: string;
  /** Rule identifier when issued by regulation engine. */
  ruleId?: string;
  /** Source reference (regulation document clause) when applicable. */
  reference?: string;
  /** Source-trail metadata for audit display. */
  sources?: SourceRef[];
  /** Rule status at evaluation time (for UI badge). */
  status?: RuleStatus;
  /** Entity id(s) this finding refers to (space/wall/opening). */
  entityIds?: string[];
  /** Optional: geometric bounding box for UI highlighting: [minX, minY, maxX, maxY] (m). */
  bbox?: [number, number, number, number];
}

export type ValidationResult = {
  ok: boolean; // true iff zero HARD findings
  findings: Finding[];
  hard: Finding[];
  soft: Finding[];
  advisory: Finding[];
};
