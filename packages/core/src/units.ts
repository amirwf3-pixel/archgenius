/**
 * Units, constants, and default conventions for ArchGenius core.
 *
 * Internal coordinate system:
 *   - origin : south-west corner of the site bounding box
 *   - X      : East
 *   - Y      : North
 *   - units  : meters (floating-point double)
 *   - angles : radians, counter-clockwise from +X (East)
 *
 * DXF export:
 *   - units  : millimeters (INSUNITS = 4)
 *   - coordinates written as `m * MM_PER_M`
 */

export const METERS_PER_MM = 0.001;
export const MM_PER_M = 1000;

/** Geometric epsilon in meters (~1 micrometer). Used for overlap / equality tests. */
export const EPS = 1e-6;

/** Default wall thicknesses (meters). */
export const WALL_EXT_THK = 0.35; // ~35 cm exterior (bearing + cladding)
export const WALL_INT_THK = 0.15; // ~15 cm interior partition
export const WALL_PARTITION_THK = 0.10;
export const WALL_CORE_THK = 0.20; // ~20 cm stair/elevator core (fire rated)
export const WALL_SERVICE_THK = 0.12; // ~12 cm service / wet area

/** Door defaults (meters). */
export const DOOR_EXT_WIDTH = 1.0;
export const DOOR_EXT_HEIGHT = 2.10;
export const DOOR_INT_WIDTH = 0.90;
export const DOOR_INT_HEIGHT = 2.10;
export const DOOR_BATH_WIDTH = 0.80;
export const DOOR_SWING_RADIUS = 0.90;

/** Window defaults (meters). */
export const WINDOW_SILL = 0.90;
export const WINDOW_LINTEL = 2.40;
export const WINDOW_MIN_WIDTH = 0.60;
export const WINDOW_MAX_WIDTH_PER_RUN = 3.0;

/** Stair defaults (meters). */
export const STAIR_MIN_WIDTH = 1.10;
export const STAIR_RISER_MAX = 0.18;
export const STAIR_TREAD_MIN = 0.28;
export const STAIR_FLIGHT_MIN_LEN = 2.40;

/** Parking defaults (meters). */
export const PARKING_STALL_WIDTH = 2.50;
export const PARKING_STALL_LENGTH = 5.00;
export const PARKING_AISLE_MIN_WIDTH = 3.50;

/** Minimum room dimensions (meters). ROOM_MIN_AREA here is the
 *  "zero-area" heuristic (anything below is almost-certainly degenerate
 *  geometry, not just a small room). Per-space minima are enforced per
 *  the space program's minArea. */
export const ROOM_MIN_SIDE = 0.90;
export const ROOM_MIN_AREA = 1.0;

/** Corridor / circulation defaults. */
export const CORRIDOR_MIN_WIDTH = 1.10;
export const CORRIDOR_PUBLIC_WIDTH = 1.50;
