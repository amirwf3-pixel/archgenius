import type { Rect } from '../geometry/rect.js';

export type ParkingArrangement = 'perpendicular' | 'parallel' | 'angled';

export interface ParkingStall {
  id: string;
  /** Stall rectangle (m). */
  rect: Rect;
  /** Index (1-based). */
  index: number;
  /** Whether this is a covered stall. */
  covered: boolean;
  /** Whether this stall is accessible (handicap). */
  accessible?: boolean;
  floor: number;
}

export interface ParkingArea {
  /** Aisle driving rectangle(s) — V1: one central aisle. */
  aisleRect: Rect;
  arrangement: ParkingArrangement;
}
