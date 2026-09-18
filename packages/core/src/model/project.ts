import type { SiteInput } from './site.js';
import type { BuildingInput } from './building.js';
import type { LayoutCandidate } from './layout.js';

export interface ProjectInput {
  name: string;
  client?: string;
  description?: string;
  /** ISO 3166-1 alpha-2 country code, defaults to 'ir'. */
  country?: string;
  /** Regulation jurisdiction identifier (e.g. 'ir-national', 'ir-tehran'). */
  regulationJurisdiction?: string;
  site: SiteInput;
  building: BuildingInput;
  /** Regulation packs to apply (ids). */
  regulationPacks?: string[];
  /** Determinism flag. */
  deterministic?: boolean;
  /** Seed for reproducible generation. */
  seed?: number;
}

export interface Project {
  id: string;
  input: ProjectInput;
  /** Generated candidates. */
  candidates?: LayoutCandidate[];
  /** Currently selected candidate id. */
  selectedCandidateId?: string;
  /** Project creation time. */
  createdAt: number;
  /** Last updated. */
  updatedAt: number;
  /** Schema version for forward-compatible storage. */
  schemaVersion: number;
}

export const PROJECT_SCHEMA_VERSION = 1;
