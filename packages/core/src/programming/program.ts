/**
 * Space programming: convert user building input into a list of SpaceSpecs
 * (target/min area, privacy, adjacency, etc.).
 *
 * Programming strategy for single-unit buildings (V1):
 *   - Single-floor villas  → all rooms (public + bedrooms) on ground floor.
 *   - Multi-floor villas   → ground floor: public/guest/service; upper floors:
 *     private (bedrooms, baths, family room) + stair-hall.
 *   - Apartments & apartment buildings (first vertical slice: single unit per
 *     floor) → bedrooms on the same floor as living (single-level).
 *
 * Default areas come from typical Iranian residential standards — they are
 * engineering TARGETS, not legal minima. Where legal minima exist, they
 * should be enforced by a regulation pack.
 */
import type { BuildingInput } from '../model/building.js';
import type { SpaceSpec, SpaceType, AdjacencyRequirement } from '../model/space.js';
import { elevatorCellSize } from '../model/stairs.js';

interface AreaProfile {
  target: number;
  min: number;
  minWidth?: number;
}

const TYPICAL_AREAS: Record<SpaceType, AreaProfile> = {
  'entrance':        { target: 3.0,  min: 2.0, minWidth: 1.2 },
  'foyer':           { target: 4.0,  min: 3.0, minWidth: 1.4 },
  'living':          { target: 18.0, min: 12.0, minWidth: 3.0 },
  'dining':          { target: 10.0, min: 7.0, minWidth: 2.4 },
  'kitchen':         { target: 10.0, min: 6.0, minWidth: 2.0 },
  'guest-wc':        { target: 2.2,  min: 1.4, minWidth: 1.1 },
  'bedroom':         { target: 12.0, min: 9.0, minWidth: 2.5 },
  'master-bedroom':  { target: 16.0, min: 12.0, minWidth: 2.8 },
  'bathroom':        { target: 3.6,  min: 2.4, minWidth: 1.3 },
  'master-bathroom': { target: 5.0,  min: 3.4, minWidth: 1.5 },
  'corridor':        { target: 4.0,  min: 1.5, minWidth: 1.1 },
  'stair-hall':      { target: 6.0,  min: 4.5, minWidth: 1.2 },
  'elevator-hall':   { target: 3.0,  min: 2.0, minWidth: 1.2 },
  'storage':         { target: 2.5,  min: 1.4, minWidth: 1.0 },
  'balcony':         { target: 4.0,  min: 2.0, minWidth: 1.2 },
  'yard':            { target: 20.0, min: 10.0 },
  'parking':         { target: 12.5, min: 11.0, minWidth: 2.5 },
  'utility':         { target: 3.0,  min: 2.0, minWidth: 1.2 },
  'family-room':     { target: 12.0, min: 8.0, minWidth: 2.6 },
  'guest-room':      { target: 10.0, min: 8.0, minWidth: 2.5 },
};

const ADJ_LIVING_DINING: AdjacencyRequirement = { spaceType: 'dining', adjacent: true, weight: 3 };
const ADJ_DINING_KITCHEN: AdjacencyRequirement = { spaceType: 'kitchen', adjacent: true, weight: 3, doorRequired: true };
const ADJ_ENTRANCE_FOYER: AdjacencyRequirement = { spaceType: 'foyer', adjacent: true, weight: 3, doorRequired: true };
const ADJ_FOYER_LIVING: AdjacencyRequirement = { spaceType: 'living', adjacent: true, weight: 3, doorRequired: true };
const ADJ_FOYER_GUESTWC: AdjacencyRequirement = { spaceType: 'guest-wc', adjacent: true, weight: 2, doorRequired: true };
const ADJ_CORRIDOR_BED: AdjacencyRequirement = { spaceType: 'corridor', adjacent: true, weight: 3, doorRequired: true };
const ADJ_CORRIDOR_STAIR: AdjacencyRequirement = { spaceType: 'stair-hall', adjacent: true, weight: 3, doorRequired: true };
const ADJ_MASTER_BATH: AdjacencyRequirement = { spaceType: 'master-bathroom', adjacent: true, weight: 3, doorRequired: true };
const ADJ_KITCHEN_SERVICE: AdjacencyRequirement = { spaceType: 'utility', adjacent: true, weight: 1 };

/**
 * Elevator-hall spec sized to the elevator shaft CELL (DESIGN ASSUMPTION
 * dimensions from DEFAULT_ELEVATOR_CONFIG — not regulatory values). The cell is
 * a fixed rectangle, so min = target: minWidth runs along the landing door wall,
 * minLength across it. The placer reserves exactly this cell next to the stair
 * core during placement (never carved from leftover space afterwards).
 */
function elevatorShaftSpec(): SpaceSpec {
  const cell = elevatorCellSize();
  const area = Math.round(cell.width * cell.depth * 10000) / 10000;
  return makeSpec('elevator-hall', {
    privacy: 'service', priority: 10,
    targetArea: area, minArea: area,
    // Orientation-neutral minimums: the generic geometry gates compare
    // rect.w/rect.h to minWidth/minLength in WORLD axes, and the cell is rotated
    // for east/west landings. The exact cell (width × depth) is reserved by the
    // placer from elevatorCellSize() and verified by ELEV_SHAFT_GEOMETRY_INCONSISTENT.
    minWidth: cell.width, minLength: Math.min(cell.width, cell.depth),
    targetWidth: cell.width, targetLength: cell.depth,
  });
}

function makeSpec(type: SpaceType, overrides: Partial<SpaceSpec> = {}): SpaceSpec {
  const base = TYPICAL_AREAS[type];
  return {
    type,
    targetArea: base.target,
    minArea: base.min,
    minWidth: base.minWidth,
    privacy: 'public',
    priority: 5,
    ...overrides,
  };
}

/**
 * Returns true when bedrooms should live on this floor.
 * V1 policy:
 *  - single-floor buildings (villa with 1 floor): bedrooms on ground
 *  - multi-floor villas: bedrooms on upper floor(s)
 *  - apartments / apartment buildings: bedrooms on the same floor as the
 *    apartment (all floors contain a full unit)
 */
function bedroomsOnThisFloor(building: BuildingInput, floorLevel: number, isOnlyFloor: boolean): boolean {
  if (building.type === 'apartment' || building.type === 'apartment-building') {
    return true;
  }
  // Villas
  if (isOnlyFloor) return floorLevel === 0;
  return floorLevel > 0;
}

function isGroundPublicFloor(building: BuildingInput, floorLevel: number, isOnlyFloor: boolean): boolean {
  if (isOnlyFloor) return true;
  return floorLevel === 0;
}

/**
 * Phase 15 M3: building-level program distribution.
 *
 * The REQUIRED program of the whole building is determined once, then assigned
 * floor by floor — upper floors never blindly duplicate the full program.
 * The totals across floors always equal the requested counts (no requested room
 * is dropped or invented; the generator gets exactly the assigned program).
 *
 * Policy (villa):
 *   - Ground floor: public + service program (entrance/foyer/living/dining/kitchen/
 *     guest-wc/storage/guest-room) + vertical circulation. No bedrooms (V1 policy).
 *   - Upper floors: the private program (bedrooms, master suites with their bath,
 *     shared bathrooms, family room) distributed round-robin, lower floors first —
 *     deterministic, parametric, size-agnostic.
 *   - Master suites stay architecturally paired with their master bath (same floor).
 *   - A floor without assigned bedrooms keeps only the circulation/core program
 *     (stair hall, elevator hall, corridor) — it never receives orphan rooms.
 *
 * Policy (apartment / apartment-building, unchanged V1 vertical slice):
 *   - Every floor contains the full unit program (bedrooms with living).
 *
 * Policy (single floor): everything on the ground floor.
 */
export interface FloorProgramAllocation {
  level: number;
  /** Floor carries the public/service program (entrance/foyer/living/dining/kitchen/guest-wc/storage). */
  publicFloor: boolean;
  /** Floor carries the assigned private program (bedroom suites). */
  privateFloor: boolean;
  /** Regular (non-master) bedrooms assigned to this floor. */
  regularBedrooms: number;
  /** Master suites (master bedroom + master bath) assigned to this floor. */
  masterSuites: number;
  /** Additional shared bathrooms assigned to this floor (master baths excluded). */
  extraBathrooms: number;
  /** The (single) family room is assigned to exactly one floor. */
  familyRoomHere: boolean;
}

export function allocateBuildingProgram(building: BuildingInput, floors: number): FloorProgramAllocation[] {
  const n = Math.max(1, floors);
  const totalBeds = Math.max(1, building.bedrooms);
  const masters = Math.min(Math.max(0, building.masterBedrooms), totalBeds);
  const regular = totalBeds - masters;
  // Existing semantics: building.bathrooms includes the master baths (one per suite).
  const extraBaths = Math.max(0, Math.max(0, building.bathrooms) - masters);
  const hasFamily = !!building.hasFamilyRoom;

  if (n === 1) {
    return [{
      level: 0, publicFloor: true, privateFloor: true,
      regularBedrooms: regular, masterSuites: masters, extraBathrooms: extraBaths,
      familyRoomHere: hasFamily,
    }];
  }

  if (building.type === 'apartment' || building.type === 'apartment-building') {
    // V1 vertical slice: every floor is a full unit (documented policy, not duplication).
    const out: FloorProgramAllocation[] = [];
    for (let i = 0; i < n; i++) {
      out.push({
        level: i, publicFloor: i === 0, privateFloor: true,
        regularBedrooms: regular, masterSuites: masters, extraBathrooms: extraBaths,
        familyRoomHere: hasFamily,
      });
    }
    return out;
  }

  // Multi-floor villa: distribute the private program over the upper floors.
  // Step 1: balance the TOTAL bedrooms (master + regular) across the upper floors —
  // round-robin keeps every occupied floor within one bedroom of every other and packs
  // trailing floors empty (never a hole between occupied storeys).
  const upper = n - 1;
  const bedsPer = new Array<number>(upper).fill(0);
  for (let k = 0; k < totalBeds; k++) bedsPer[k % upper] += 1;
  const occupied: number[] = [];
  for (let i = 0; i < upper; i++) if (bedsPer[i] > 0) occupied.push(i);
  // Step 2: place master suites one per occupied floor (lower floors first) — each stays
  // architecturally paired with its master bath on the same floor.
  const mastersPer = new Array<number>(upper).fill(0);
  for (let k = 0; k < masters; k++) mastersPer[occupied[k % occupied.length]] += 1;
  // Step 3: shared baths round-robin over the occupied floors.
  const bathsPer = new Array<number>(upper).fill(0);
  for (let k = 0; k < extraBaths; k++) bathsPer[occupied[k % occupied.length]] += 1;
  const familyFloor = occupied.length > 0 ? occupied[0] : -1;

  const alloc: FloorProgramAllocation[] = [{
    level: 0, publicFloor: true, privateFloor: false,
    regularBedrooms: 0, masterSuites: 0, extraBathrooms: 0, familyRoomHere: false,
  }];
  for (let i = 0; i < upper; i++) {
    alloc.push({
      level: i + 1,
      publicFloor: false,
      privateFloor: bedsPer[i] > 0,
      regularBedrooms: bedsPer[i] - mastersPer[i],
      masterSuites: mastersPer[i],
      extraBathrooms: bathsPer[i],
      familyRoomHere: hasFamily && i === familyFloor,
    });
  }
  return alloc;
}

/**
 * Build the space program for ONE floor from its building-level allocation.
 * `alloc` is mandatory: the distribution of the required program across floors is a
 * BUILDING-level decision (Phase 15 M3) — a floor must never independently expand the
 * program to its own full request (that duplication was the pre-M3 defect).
 */
export function programForFloor(
  building: BuildingInput,
  floorLevel: number,
  isOnlyFloor: boolean,
  alloc: FloorProgramAllocation,
): SpaceSpec[] {
  const specs: SpaceSpec[] = [];
  const hasBedrooms = alloc.privateFloor;
  const isPublic = alloc.publicFloor;

  if (isPublic) {
    specs.push(makeSpec('entrance', { privacy: 'public', priority: 10, adjacencies: [ADJ_ENTRANCE_FOYER] }));
    specs.push(makeSpec('foyer', { privacy: 'public', priority: 9, adjacencies: [ADJ_FOYER_LIVING, ADJ_FOYER_GUESTWC] }));
    if (building.wc > 0) {
      specs.push(makeSpec('guest-wc', { privacy: 'public', priority: 8, minArea: 1.4, targetArea: 2.0 }));
    }
    specs.push(makeSpec('living', { privacy: 'public', priority: 9, orientation: 'south', adjacencies: [ADJ_LIVING_DINING], daylightRequired: true }));
    specs.push(makeSpec('dining', { privacy: 'semi-private', priority: 8, adjacencies: [ADJ_DINING_KITCHEN] }));

    const kitchenAdj: AdjacencyRequirement[] = [ADJ_DINING_KITCHEN];
    if (building.hasStorage) kitchenAdj.push(ADJ_KITCHEN_SERVICE);
    specs.push(makeSpec('kitchen', {
      privacy: 'semi-private', priority: 9, adjacencies: kitchenAdj,
      targetArea: building.kitchenType === 'open' ? 8 : 10,
      minArea: 5.5,
      ventilationRequired: true,
    }));

    if (building.hasGuestRoom) specs.push(makeSpec('guest-room', { privacy: 'public', priority: 5, orientation: 'south', daylightRequired: true }));
    if (building.hasStorage) specs.push(makeSpec('storage', { privacy: 'service', priority: 3, minArea: 1.4, targetArea: 2.0 }));
    // Phase 15 M3: the single requested family room lands on the allocated floor (see alloc).
    if (alloc.familyRoomHere) specs.push(makeSpec('family-room', { privacy: 'semi-private', priority: 5 }));

    // Circulation
    if (!isOnlyFloor || building.bedrooms >= 2) {
      const circAdj: AdjacencyRequirement[] = [];
      if (building.hasStair) circAdj.push(ADJ_CORRIDOR_STAIR);
      specs.push(makeSpec('corridor', { privacy: 'service', priority: 6, adjacencies: circAdj }));
    } else {
      specs.push(makeSpec('corridor', { privacy: 'service', priority: 6 }));
    }

    if (building.hasStair && !isOnlyFloor) {
      specs.push(makeSpec('stair-hall', { privacy: 'service', priority: 10, adjacencies: [ADJ_CORRIDOR_STAIR], targetArea: 6.0, minArea: 4.5 }));
    }
    // Elevator shaft: reserved only on 2+ floor buildings (a 1-floor building
    // ignores hasElevator for shaft generation).
    if (building.hasElevator && !isOnlyFloor) specs.push(elevatorShaftSpec());
  } else {
    // Upper private floor(s)
    if (building.hasStair) specs.push(makeSpec('stair-hall', { privacy: 'service', priority: 10, targetArea: 6.0, minArea: 4.5 }));
    if (building.hasElevator) specs.push(elevatorShaftSpec());
    specs.push(makeSpec('corridor', { privacy: 'service', priority: 9 }));
    if (alloc.familyRoomHere) specs.push(makeSpec('family-room', { privacy: 'semi-private', priority: 6, orientation: 'south', daylightRequired: true }));
  }

  if (hasBedrooms) {
    // Phase 15 M3: per-floor counts come from the BUILDING-level allocation —
    // never the raw whole-building request (that duplicated the program on every floor).
    const masters = alloc.masterSuites;
    const regular = alloc.regularBedrooms;
    for (let i = 0; i < masters; i++) {
      const adj: AdjacencyRequirement[] = [];
      if (building.bathrooms > 0) adj.push(ADJ_MASTER_BATH);
      adj.push(ADJ_CORRIDOR_BED);
      specs.push(makeSpec('master-bedroom', { privacy: 'private', priority: 8, orientation: 'south', daylightRequired: true, adjacencies: adj }));
      if (building.bathrooms > 0) {
        specs.push(makeSpec('master-bathroom', { privacy: 'private', priority: 7, adjacencies: [ADJ_MASTER_BATH], ventilationRequired: true, minArea: 3.4, minWidth: 1.5 }));
      }
    }
    for (let i = 0; i < regular; i++) {
      const adj: AdjacencyRequirement[] = [ADJ_CORRIDOR_BED];
      specs.push(makeSpec('bedroom', { privacy: 'private', priority: 7, orientation: i % 2 === 0 ? 'east' : 'west', daylightRequired: true, adjacencies: adj }));
    }
    const totalBaths = alloc.extraBathrooms;
    for (let i = 0; i < totalBaths; i++) {
      specs.push(makeSpec('bathroom', { privacy: 'private', priority: 6, ventilationRequired: true, minArea: 2.4, minWidth: 1.3 }));
    }
    if (building.hasBalcony) specs.push(makeSpec('balcony', { privacy: 'private', priority: 3 }));
  }

  return specs;
}

/** Compute the program for parking stalls (placed near access, separate from main footprint). */
export function parkingSpec(count: number): SpaceSpec {
  const area = 12.5 * count + 3.5 * 6;
  return {
    type: 'parking',
    targetArea: area,
    minArea: 11 * count + 20,
    minWidth: 2.5,
    privacy: 'service',
    priority: 9,
    daylightRequired: false,
    ventilationRequired: false,
  };
}

export function getTypicalArea(type: SpaceType): AreaProfile {
  return TYPICAL_AREAS[type];
}

export function labelFor(type: SpaceType, idx?: number): string {
  switch (type) {
    case 'bedroom': return `Bedroom ${(idx ?? 0) + 1}`;
    case 'bathroom': return `Bathroom ${(idx ?? 0) + 1}`;
    case 'master-bedroom': return 'Master Bedroom';
    case 'master-bathroom': return 'Master Bathroom';
    case 'guest-wc': return 'Guest WC';
    case 'guest-room': return 'Guest Room';
    case 'family-room': return 'Family Room';
    case 'living': return 'Living Room';
    case 'dining': return 'Dining';
    case 'kitchen': return 'Kitchen';
    case 'entrance': return 'Entrance';
    case 'foyer': return 'Foyer';
    case 'corridor': return 'Corridor';
    case 'stair-hall': return 'Stair Hall';
    case 'elevator-hall': return 'Elevator Shaft';
    case 'storage': return 'Storage';
    case 'balcony': return 'Balcony';
    case 'yard': return 'Yard';
    case 'parking': return 'Parking';
    case 'utility': return 'Utility';
    default: return type;
  }
}
