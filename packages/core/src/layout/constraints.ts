/**
 * Constraint graph model for residential layout.
 *
 * Explicit, data-driven relationships between spaces: adjacency,
 * separation, access, and privacy. The graph is consumed by the
 * layout placer (./layout.ts) and validated by
 * ../../validation/circulation.ts.
 */
import type { SpaceType, PrivacyBand, Zone } from '../model/space.js';

/** Constraint strength. HARD failures dominate ranking. */
export type ConstraintStrength = 'hard' | 'soft';

/**
 * MUST_BE_ADJACENT       — hard wall-sharing requirement (e.g. entrance↔foyer)
 * PREFER_ADJACENT        — soft adjacency preference (e.g. living↔dining)
 * MUST_BE_SEPARATED      — hard separation (e.g. bedroom↔entrance unless circulation buffers)
 * PREFER_SEPARATED       — soft separation (e.g. bathroom↔living)
 * DIRECT_ACCESS_REQUIRED — hard door between the two spaces (e.g. master↔master-bath)
 * PRIVACY_REQUIRED       — the two spaces must not share a direct door; access must be through circulation of strictly lower privacy
 */
export type ConstraintKind =
  | 'MUST_BE_ADJACENT'
  | 'PREFER_ADJACENT'
  | 'MUST_BE_SEPARATED'
  | 'PREFER_SEPARATED'
  | 'DIRECT_ACCESS_REQUIRED'
  | 'PRIVACY_REQUIRED';

export interface SpaceConstraint {
  /** Unique id, useful for reporting. */
  id: string;
  kind: ConstraintKind;
  strength: ConstraintStrength;
  /** The space TYPE this constraint applies from (type-level — applies between any two instances of the types). */
  fromType: SpaceType;
  toType: SpaceType;
  /** Optional label to surface in metrics/explanations. */
  note?: string;
}

/**
 * A placed-space requirement tied to a concrete placed Space.id once
 * placement begins. Used by the validator and metrics engine.
 */
export interface InstanceConstraint {
  constraintId: string;
  fromId: string;
  toId: string;
  satisfied: boolean;
}

/**
 * Zoning plan: ordered list of zones with their preferred bands relative
 * to the access facade. Layout strategy may permute or rotate this.
 */
export interface ZonePlan {
  zone: Zone;
  /** Fraction of footprint depth allocated to this zone along the primary circulation axis. */
  depthFraction: number;
  /** Types that must sit in this zone. */
  types: SpaceType[];
}

/**
 * Default residential constraints (data-driven, not hardcoded in placer).
 *
 * In Iranian residential praxis:
 *  - Living ↔ Dining: prefer adjacent (open-plan continuity)
 *  - Dining ↔ Kitchen: prefer adjacent + direct access (service path)
 *  - Master-Bedroom ↔ Master-Bathroom: prefer adjacent + direct access
 *  - Bedroom ↔ Entrance: MUST be separated (privacy) by circulation
 *  - Bathroom ↔ Living / Dining / Kitchen: prefer separated (odour/sight)
 *  - Entrance ↔ Foyer: hard adjacency (door)
 *  - Foyer ↔ Living: hard direct access (guests greeted into living)
 *  - Foyer ↔ Guest-WC: prefer adjacent (guest reachable w/o crossing private)
 *  - Kitchen ↔ Storage/Utility: prefer adjacent
 *  - Corridor ↔ Bedrooms: hard direct access
 *  - Stair ↔ Corridor: hard adjacency (vertical circulation ties in)
 */
export const DEFAULT_RESIDENTIAL_CONSTRAINTS: SpaceConstraint[] = [
  // ---- Hard adjacencies / direct access ----
  { id: 'c-entr-foyer', kind: 'MUST_BE_ADJACENT',       strength: 'hard', fromType: 'entrance',       toType: 'foyer',           note: 'Entrance must open into a foyer/vestibule.' },
  { id: 'c-foyer-liv',   kind: 'DIRECT_ACCESS_REQUIRED', strength: 'hard', fromType: 'foyer',          toType: 'living',          note: 'Foyer must open directly onto living zone.' },
  { id: 'c-corr-bed',    kind: 'DIRECT_ACCESS_REQUIRED', strength: 'hard', fromType: 'corridor',       toType: 'bedroom',         note: 'Each bedroom opens directly off a corridor.' },
  { id: 'c-corr-mbed',   kind: 'DIRECT_ACCESS_REQUIRED', strength: 'hard', fromType: 'corridor',       toType: 'master-bedroom',  note: 'Master bedroom opens off corridor (or stair-hall).' },
  { id: 'c-corr-stair',  kind: 'MUST_BE_ADJACENT',       strength: 'hard', fromType: 'corridor',       toType: 'stair-hall',      note: 'Stair-hall must adjoin corridor circulation.' },
  { id: 'c-corr-bath',   kind: 'DIRECT_ACCESS_REQUIRED', strength: 'hard', fromType: 'corridor',       toType: 'bathroom',        note: 'Shared bathroom must open off corridor.' },
  { id: 'c-corr-mbath',  kind: 'MUST_BE_ADJACENT',       strength: 'hard', fromType: 'corridor',       toType: 'master-bathroom', note: 'Master bathroom must be reachable through corridor-adjacent master bedroom.' },

  // ---- Soft adjacencies ----
  { id: 'p-liv-din',     kind: 'PREFER_ADJACENT',        strength: 'soft', fromType: 'living',         toType: 'dining',          note: 'Living ↔ Dining continuity preferred.' },
  { id: 'p-din-kit',     kind: 'PREFER_ADJACENT',        strength: 'soft', fromType: 'dining',         toType: 'kitchen',         note: 'Dining adjacent to kitchen for service.' },
  { id: 'p-kit-din-door',kind: 'DIRECT_ACCESS_REQUIRED', strength: 'soft', fromType: 'kitchen',        toType: 'dining' },
  { id: 'p-mb-mbath',    kind: 'PREFER_ADJACENT',        strength: 'soft', fromType: 'master-bedroom', toType: 'master-bathroom', note: 'Master ensuite preferred.' },
  { id: 'p-mb-mbath-dr', kind: 'DIRECT_ACCESS_REQUIRED', strength: 'soft', fromType: 'master-bedroom', toType: 'master-bathroom' },
  { id: 'p-foyer-gwc',   kind: 'PREFER_ADJACENT',        strength: 'soft', fromType: 'foyer',          toType: 'guest-wc',        note: 'Guest WC near foyer.' },
  { id: 'p-kit-stor',    kind: 'PREFER_ADJACENT',        strength: 'soft', fromType: 'kitchen',        toType: 'storage',         note: 'Storage/pantry near kitchen.' },

  // ---- Separation ----
  { id: 's-bed-entr',    kind: 'MUST_BE_SEPARATED',      strength: 'hard', fromType: 'bedroom',        toType: 'entrance',        note: 'Bedroom must not open directly to entrance.' },
  { id: 's-mbed-entr',   kind: 'MUST_BE_SEPARATED',      strength: 'hard', fromType: 'master-bedroom', toType: 'entrance',        note: 'Master bedroom must not open directly to entrance.' },
  { id: 's-bed-foyer',   kind: 'MUST_BE_SEPARATED',      strength: 'hard', fromType: 'bedroom',        toType: 'foyer' },
  { id: 's-mbed-foyer',  kind: 'MUST_BE_SEPARATED',      strength: 'hard', fromType: 'master-bedroom', toType: 'foyer' },
  { id: 's-bath-liv',    kind: 'PREFER_SEPARATED',       strength: 'soft', fromType: 'bathroom',       toType: 'living',          note: 'Bathroom door should not face living.' },
  { id: 's-bath-din',    kind: 'PREFER_SEPARATED',       strength: 'soft', fromType: 'bathroom',       toType: 'dining' },
  { id: 's-bath-kit',    kind: 'PREFER_SEPARATED',       strength: 'soft', fromType: 'bathroom',       toType: 'kitchen' },
  { id: 's-mbath-liv',   kind: 'PREFER_SEPARATED',       strength: 'soft', fromType: 'master-bathroom',toType: 'living' },
  { id: 's-wc-kit',      kind: 'PREFER_SEPARATED',       strength: 'soft', fromType: 'guest-wc',       toType: 'kitchen' },
];

/** Default zone plan (south access / north up): PUBLIC-SERVICE-PRIVATE strips from south to north. */
export const DEFAULT_ZONE_PLAN_SOUTH_ACCESS: ZonePlan[] = [
  { zone: 'public',      depthFraction: 0.40, types: ['entrance', 'foyer', 'living', 'dining', 'guest-wc', 'guest-room'] },
  { zone: 'circulation', depthFraction: 0.12, types: ['corridor', 'stair-hall', 'elevator-hall'] },
  { zone: 'semi-private',depthFraction: 0.18, types: ['kitchen', 'family-room', 'storage', 'utility'] },
  { zone: 'private',     depthFraction: 0.30, types: ['bedroom', 'master-bedroom', 'bathroom', 'master-bathroom', 'balcony'] },
];

/** Lookup privacy < zone mapping for circulation classification. */
export function privacyToZone(p: PrivacyBand): Zone {
  switch (p) {
    case 'public':       return 'public';
    case 'semi-private': return 'semi-private';
    case 'private':      return 'private';
    default:             return 'service';
  }
}

/** Return true if direct access between two privacies is permitted without a circulation buffer. */
export function privacyTransitionAllowed(from: PrivacyBand, to: PrivacyBand): boolean {
  // Same band always allowed.
  if (from === to) return true;
  // Public → semi-private is allowed (e.g. living→dining).
  if (from === 'public' && to === 'semi-private') return true;
  if (from === 'semi-private' && to === 'public') return true;
  // Semi-private ↔ private allowed only via circulation (handled elsewhere);
  // no direct door between public and private.
  return false;
}
