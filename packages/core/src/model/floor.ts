import type { Space } from './space.js';
import type { Wall } from './wall.js';
import type { Opening } from './opening.js';
import type { Stair, Elevator } from './stairs.js';
import type { ParkingStall, ParkingArea } from './parking.js';
import type { Furniture } from './furniture.js';
import type { Rect } from '../geometry/rect.js';

export interface Floor {
  /** 0 = ground floor */
  level: number;
  /** Floor height (floor-to-floor), m */
  floorHeight: number;
  /** Finished floor elevation relative to site zero, m */
  elevation: number;
  /** Buildable footprint rectangle on this floor (in plan coordinates). */
  footprint: Rect;
  /** Placed spaces (rooms, corridors, etc.). */
  spaces: Space[];
  /** Walls on this floor. */
  walls: Wall[];
  /** Openings (doors, windows) on this floor. */
  openings: Opening[];
  /** Stair(s) on this floor. */
  stairs: Stair[];
  /** Elevator(s) on this floor. */
  elevators: Elevator[];
  /** Furniture footprints (beds, sofas, sanitary, cars, etc.). */
  furniture: Furniture[];
  /** Parking stalls (populated on ground floor when applicable). */
  parkingStalls: ParkingStall[];
  parkingArea?: ParkingArea;
  /** P16-A: stalls the program requested on this floor (ground floor only);
   *  the plan must place exactly this many or surface a HARD finding. */
  parkingRequested?: number;
  /** P16-B: street side this floor's entrance must face (generator stamped;
   *  validator enforces for ground floors). Undefined on hand-built fixtures. */
  accessSide?: 'north'|'south'|'east'|'west';
}
