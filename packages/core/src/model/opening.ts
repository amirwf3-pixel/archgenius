import type { Vec2 } from '../geometry/vec2.js';

export type OpeningType = 'door' | 'window' | 'entrance' | 'sliding-door';

export type DoorSwing = 'left' | 'right' | 'sliding';

export interface Opening {
  id: string;
  type: OpeningType;
  /** The wall this opening sits on. */
  wallId: string;
  /** Opening center point along wall centerline. */
  center: Vec2;
  /** Direction along the wall (normalized) from start to end. */
  wallDir: Vec2;
  /** Normal pointing into the destination/inside space. */
  normal: Vec2;
  /** Width of opening (m). */
  width: number;
  /** Height of opening (m). */
  height: number;
  /** Sill height above finished floor (m). 0 for doors. */
  sill: number;
  /** For doors: swing side, hinge offset, etc. */
  swing?: DoorSwing;
  /** Floor number. */
  floor: number;
  /** Space ids on each side of the wall (mirror of wall.spaceIds but handy). */
  spaceA?: string;
  spaceB?: string;
}
