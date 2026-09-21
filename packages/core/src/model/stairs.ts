/**
 * Stair domain model (Phase 4).
 *
 * A Stair connects two adjacent floors via one or more Flights separated by
 * Landings. All geometry is axis-aligned in V1 (the engine may rotate the
 * plan per candidate orientation).
 *
 * Conventions (deterministic):
 *   - treadCount per flight = riserCount - 1  (the last riser arrives at the
 *     landing / upper floor, which does not have its own tread in the run).
 *   - runLength = treadCount * treadDepth (horizontal run, nosing excluded).
 *   - totalRise ≈ Σ flight.riserCount × riserHeight (≤ 1 mm tolerance).
 *   - "up" direction is the travel direction from startPoint to endPoint
 *     (for STRAIGHT/L/U geometries below).
 */
import type { Rect } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';

/** Direction of travel along a flight, in plan (X/Y) coordinates. */
export type StairDirection = 'north' | 'south' | 'east' | 'west';

/** Configured stair geometry type. */
export type StairType = 'straight' | 'u-stair' | 'l-stair';

/** One straight run of treads between two levels/landings. */
export interface StairFlight {
  id: string;
  /** Direction of travel (up direction in plan). */
  direction: StairDirection;
  /** Number of risers in THIS flight (≥ 1). */
  riserCount: number;
  /** Tread count = riserCount − 1. */
  treadCount: number;
  /** Riser height (m) for this flight (uniform across the whole stair). */
  riserHeight: number;
  /** Tread depth (m) going (m) for this flight. */
  treadDepth: number;
  /** Clear flight width (m). */
  width: number;
  /** Horizontal run length = treadCount × treadDepth (m). */
  runLength: number;
  /** Center of the first nosing (start point of run, m). */
  startPoint: Vec2;
  /** Center of the top landing-nosing arrival (end of run, m). */
  endPoint: Vec2;
  /** Axis-aligned bounding box of this flight (includes stringers). */
  footprint: Rect;
  /** Indices of tread lines along the run (for DXF). Each tread is a line
   *  across the flight perpendicular to the travel direction. treadLines[i]
   *  is the distance from startPoint to the i-th tread riser face. */
  treadLines: number[];
}

/** Intermediate or top/bottom landing (horizontal platform). */
export interface StairLanding {
  id: string;
  /** Axis-aligned bounding box. */
  footprint: Rect;
  /** Clear width = flight width at minimum. */
  width: number;
  /** Depth along travel direction (m). */
  depth: number;
  /** Flight indices that feed into this landing, by connection order.
   *  The first entry is the flight arriving at this landing; the second
   *  (if present) is the departing flight. For the top/bottom floor
   *  landing there is one connected flight. */
  connectedFlightIds: string[];
}

export interface Stair {
  id: string;
  /** Stair type chosen by the solver. */
  type: StairType;
  /** StairCore anchor id — same across floors for vertical coherence. */
  coreId: string;
  /** Floor-to-floor total rise (m). */
  totalRise: number;
  /** Total riser count = Σ flight.riserCount. */
  totalRisers: number;
  /** Uniform riser height (m). */
  riserHeight: number;
  /** Uniform tread depth (m, going). */
  treadDepth: number;
  /** Clear flight width (m). */
  width: number;
  /** Ordered flights (bottom → top). */
  flights: StairFlight[];
  /** Landings between flights + (optionally) bottom/top arrival pads. */
  landings: StairLanding[];
  /** Overall axis-aligned bounding box of the whole stairwell. */
  footprint: Rect;
  /** Start point on lower floor (first nosing center at floor level). */
  startPoint: Vec2;
  /** End point on upper floor (last nosing center at floor level). */
  endPoint: Vec2;
  /** Floor level containing the bottom of this stair. */
  floor: number;
  /** Next-floor stair id (for core alignment across floors). */
  nextFloorId?: string;
  /** Phase15 M7: which hall side the entry (bottom riser) faces — set by the
   *  vertical-core orientation search; part of the coherent core contract. */
  entrySide?: 'north' | 'south' | 'east' | 'west';
  /** Phase15 M7 headroom ADVISORY. This is a 2D plan engine: no 3D volume model
   *  exists, so the VERIFIED regulation threshold (MBH4 §4-5-1-7-6, 2.05 m —
   *  enforced-metadata via pack rule MBH4-STAIR-003) CANNOT be geometrically
   *  checked here. This field documents the limitation; it never claims
   *  compliance and never suppresses the pack's own checks. */
  headroom?: {
    status: 'NOT_IMPLEMENTED';
    thresholdM: number;
    source: string;
    note: string;
  };
  /** Structured explanation entries for UI/logging. */
  explanation: string[];
  /** Validation metadata attached by stair validation. */
  valid: boolean;

  // ---- Legacy V1 aliases (kept for backward compatibility with DXF writer
  //      and existing regulation rules). All map to new fields. ---------
  /** @deprecated Use `footprint`. */
  rect: Rect;
  /** @deprecated Use `width`. */
  flightWidth: number;
  /** @deprecated Use `riserHeight`. */
  riser: number;
  /** @deprecated Use `treadDepth`. */
  tread: number;
  /** @deprecated Use `totalRisers` — regulatory check now iterates flights. */
  riserCount: number;
  /** @deprecated Use `totalRise`. */
  floorHeight: number;
}

export interface StairConfig {
  /** Floor-to-floor rise (m). */
  floorHeight: number;
  /** Maximum permitted risers per flight (MBH4 §4-5-1-7-5 = 12). */
  maxRisersPerFlight: number;
  /** Maximum permitted riser height (m) — MBH4 §4-5-1-7-1 = 0.18. */
  maxRiserHeight: number;
  /** Minimum tread depth (m) — MBH4 §4-5-1-7-1 = 0.28. */
  minTreadDepth: number;
  /** Minimum clear stair width (m). */
  minWidth: number;
  /** Minimum landing depth (m) — code requires ≥ stair width; V1 uses
   *  max(width, 1.0) for small widths. */
  minLandingDepth: number;
}

/** Default configuration matching Iranian MBR Phase-3 constants. */
export const DEFAULT_STAIR_CONFIG: StairConfig = {
  floorHeight: 3.20,
  maxRisersPerFlight: 12,
  maxRiserHeight: 0.18,
  minTreadDepth: 0.28,
  minWidth: 1.10,
  minLandingDepth: 1.00,
};

export interface Elevator {
  id: string;
  /** Shaft rectangle (m). */
  rect: Rect;
  /** Cabin width x depth. */
  cabinWidth: number;
  cabinDepth: number;
  floor: number;
}
