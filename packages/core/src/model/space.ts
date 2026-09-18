import type { Rect } from '../geometry/rect.js';
import type { Polygon } from '../geometry/polygon.js';

/** Architectural space types. V1 supports the listed residential spaces. */
export type SpaceType =
  | 'entrance'
  | 'foyer'
  | 'living'
  | 'dining'
  | 'kitchen'
  | 'guest-wc'
  | 'bedroom'
  | 'master-bedroom'
  | 'bathroom'
  | 'master-bathroom'
  | 'corridor'
  | 'stair-hall'
  | 'elevator-hall'
  | 'storage'
  | 'balcony'
  | 'yard'
  | 'parking'
  | 'utility'
  | 'family-room'
  | 'guest-room';

export type PrivacyBand = 'public' | 'semi-private' | 'private' | 'service';

/** Architectural zone. 'service' covers kitchen/utility/storage too. */
export type Zone = 'public' | 'semi-private' | 'private' | 'service' | 'circulation';

export type OrientationPref = 'north' | 'south' | 'east' | 'west' | 'any';

/** Relationship with another space. Legacy adjacency model kept for backwards compatibility. */
export interface AdjacencyRequirement {
  spaceType?: SpaceType;
  /** If true, direct wall adjacency is required; if false, must be separated. */
  adjacent: boolean;
  /** Weight in optimization penalty (higher = more important). */
  weight: number;
  /** If specified, requires a door between the two spaces. */
  doorRequired?: boolean;
}

export interface SpaceSpec {
  type: SpaceType;
  /** Target area (m²) */
  targetArea: number;
  /** Minimum acceptable area (m²) — HARD constraint. */
  minArea: number;
  /** Ideal width (m). */
  targetWidth?: number;
  minWidth?: number;
  targetLength?: number;
  minLength?: number;
  /** Preferred width:length aspect ratio (long side / short side). 1.0 = square. */
  preferredAspectRatio?: number;
  privacy: PrivacyBand;
  /** Architectural zone override (defaults by privacy band if absent). */
  zone?: Zone;
  orientation?: OrientationPref;
  daylightRequired?: boolean;
  ventilationRequired?: boolean;
  naturalLightPreferred?: boolean;
  /** Higher = placed earlier in the placer sweep. */
  priority: number;
  /** Legacy adjacency list (still honoured). New code should use the constraint graph in layout/constraints.ts. */
  adjacencies?: AdjacencyRequirement[];
  /** Separated-from types (e.g. bathroom adjacent to kitchen is bad). */
  separations?: Array<{ spaceType: SpaceType; weight: number }>;
}

export interface Space {
  id: string;
  type: SpaceType;
  label: string; // display name, e.g. "Bedroom 1"
  privacy: PrivacyBand;
  /** Architectural zone this space belongs to. */
  zone: Zone;
  orientation?: OrientationPref;
  daylightRequired?: boolean;
  /** Axis-aligned bounding rectangle (V1: the room is exactly this rect). */
  rect: Rect;
  /** Room polygon (same as rect corners in V1). */
  polygon: Polygon;
  /** Computed area m². */
  area: number;
  targetArea: number;
  minArea: number;
  /** Ids of walls that bound this space. */
  wallIds: string[];
  /** Ids of opening (doors/windows) on this space's boundary. */
  openingIds: string[];
  /** Ids of adjacent spaces (sharing a wall). */
  adjacentSpaceIds: string[];
  /** Whether this space is placed on an exterior wall. */
  hasExteriorWall: boolean;
  /** Floor number (0 = ground). */
  floor: number;
}
