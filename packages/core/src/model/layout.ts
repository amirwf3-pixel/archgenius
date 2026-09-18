import type { Floor } from './floor.js';
import type { Rect } from '../geometry/rect.js';
import type { Finding } from '../validation/types.js';
import type { LayoutMetrics } from '../optimizer/metrics.js';

export type CandidateStrategy =
  | 'area-efficiency'
  | 'functional-circulation'
  | 'daylight-orientation'
  | 'alternative-zoning';

export interface LayoutMetadata {
  /** Strategy used when generating this candidate. */
  strategy: CandidateStrategy;
  /** Random seed used for any tie-breaking. */
  seed: number;
  /** Generation timestamp (ms since epoch). */
  generatedAt: number;
  /** Regulation packs used, with versions. */
  regulationPacks: Array<{ id: string; edition: string }>;
}

export interface LayoutCandidate {
  id: string;
  /** Site buildable-area rectangle (on floor 0). */
  buildableArea: Rect;
  /** Floors in this layout (length == floors input). */
  floors: Floor[];
  /** Full validation findings. */
  findings: Finding[];
  /** True if no HARD constraint violations. */
  valid: boolean;
  /** Metrics for comparison. */
  metrics: LayoutMetrics;
  /** Design explanation entries (derived from real generation decisions). */
  explanations: string[];
  metadata: LayoutMetadata;
}
