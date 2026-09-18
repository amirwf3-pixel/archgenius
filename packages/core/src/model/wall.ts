import type { Vec2 } from '../geometry/vec2.js';

export type WallKind = 'exterior' | 'interior' | 'partition' | 'retaining';

export interface Wall {
  id: string;
  kind: WallKind;
  /** Centerline start. */
  start: Vec2;
  /** Centerline end. */
  end: Vec2;
  /** Wall thickness (m). */
  thickness: number;
  /** Ids of spaces adjacent on each side. Length 0..2.
   *  sides[0] = left when traversing start→end; sides[1] = right. */
  spaceIds: [string | null, string | null];
  /** Ids of openings (doors/windows) that punch this wall. */
  openingIds: string[];
  /** Floor number (0 = ground). */
  floor: number;
}
