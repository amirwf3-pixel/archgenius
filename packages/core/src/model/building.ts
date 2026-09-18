/** Building type and building-level parameters. */

export type BuildingType = 'villa' | 'apartment' | 'apartment-building';

export type KitchenType = 'closed' | 'open' | 'semi-open';

export const BUILDING_FLOORS_MIN = 1;
export const BUILDING_FLOORS_MAX = 10;

export interface BuildingInput {
  type: BuildingType;
  /** Number of above-ground floors (including ground floor). Validated 1..10, first-class deterministic input. */
  floors: number;
  /** Number of residential units per typical floor (1 for villas). */
  unitsPerFloor?: number;
  /** Total target gross floor area per floor (m²), approximate. */
  targetGrossArea?: number;
  /** Total target net area (usable area) per floor (m²), approximate. */
  targetNetArea?: number;

  // ------- Residential program counts (per unit for multi-unit) -------
  bedrooms: number;        // total bedrooms including master
  masterBedrooms: number;  // bedrooms that are master (ensuite)
  bathrooms: number;       // full bathrooms
  wc: number;              // separate guest/WC
  kitchenType: KitchenType;
  parkingSpaces: number;   // required parking stalls

  // ------- Circulation / service -------
  hasElevator?: boolean;
  hasStair?: boolean;          // usually true for >1 floor
  hasBalcony?: boolean;
  hasStorage?: boolean;
  hasYard?: boolean;           // yard/courtyard
  hasGuestRoom?: boolean;
  hasFamilyRoom?: boolean;     // separate family/TV room

  /** Additional structured requirements. */
  notes?: string[];
}
