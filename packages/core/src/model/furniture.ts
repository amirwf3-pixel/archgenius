/**
 * Minimal furniture footprints for usability / clearance / collision QA.
 *
 * Furniture is NOT decorative; every footprint is used by the validator to
 * confirm the space can actually receive its intended function, and is also
 * drawn on the DXF on layer A-FURN for QA readability. Dimensions follow
 * Iranian residential common practice.
 */
import type { Rect } from '../geometry/rect.js';
import type { Vec2 } from '../geometry/vec2.js';

export type FurnitureType =
  | 'bed-single'
  | 'bed-double'
  | 'bed-king'
  | 'sofa-3seat'
  | 'sofa-2seat'
  | 'dining-table-4'
  | 'dining-table-6'
  | 'kitchen-counter-single'
  | 'kitchen-counter-l'
  | 'toilet'
  | 'sink'
  | 'shower'
  | 'bathtub'
  | 'wardrobe'
  | 'car';

export interface Furniture {
  id: string;
  type: FurnitureType;
  /** Bounding axis-aligned rectangle inside the room (m). */
  rect: Rect;
  /** Orientation (degrees, 0 = aligned with room axes). V1 always axis-aligned. */
  rotation: number;
  /** Space this furniture lives in. */
  spaceId: string;
  /** Optional label (e.g. "Sofa 1"). */
  label?: string;
  /** Clearance zone required in front of the unit (m rectangle, measured from unit edge). */
  clearanceFront?: number;
}

/** Default footprint sizes for furniture (width × depth, in meters). */
export const FURNITURE_SIZES: Record<FurnitureType, { w: number; d: number; clearanceFront?: number }> = {
  'bed-single':           { w: 1.00, d: 2.00, clearanceFront: 0.70 },
  'bed-double':           { w: 1.60, d: 2.00, clearanceFront: 0.70 },
  'bed-king':             { w: 1.80, d: 2.00, clearanceFront: 0.70 },
  'sofa-3seat':           { w: 2.20, d: 0.90, clearanceFront: 0.80 },
  'sofa-2seat':           { w: 1.60, d: 0.90, clearanceFront: 0.80 },
  'dining-table-4':       { w: 1.20, d: 0.80, clearanceFront: 0.80 },
  'dining-table-6':       { w: 1.80, d: 0.90, clearanceFront: 0.80 },
  'kitchen-counter-single':{w: 2.40, d: 0.60, clearanceFront: 1.00 },
  'kitchen-counter-l':    { w: 2.60, d: 1.80, clearanceFront: 1.00 },
  'toilet':               { w: 0.50, d: 0.70, clearanceFront: 0.50 },
  'sink':                 { w: 0.60, d: 0.50, clearanceFront: 0.50 },
  'shower':               { w: 0.90, d: 0.90, clearanceFront: 0.70 },
  'bathtub':              { w: 1.70, d: 0.75, clearanceFront: 0.50 },
  'wardrobe':             { w: 1.80, d: 0.60, clearanceFront: 0.60 },
  'car':                  { w: 2.50, d: 5.00, clearanceFront: 0 }, // placed by parking module
};
