import type { Severity } from '../validation/types.js';
import type { ProjectInput } from '../model/project.js';
import type { LayoutCandidate } from '../model/layout.js';

export type RuleStatus =
  | 'VERIFIED'                 // clause verified against a Tier 1 (official BHRC) document held in sources/
  | 'REQUIRES_SOURCE_VERIFICATION' // rule transcribed from secondary sources; MUST NOT be presented as compliance
  | 'NOT_IMPLEMENTED'          // slot reserved; evaluator emits only an advisory note
  | 'DEPRECATED';              // rule superseded or found incorrect

/** Source tier per the audit policy.
 *  1 = official government / BHRC publication (PDF in sources/, e.g. inbr.ir)
 *  2 = officially published reproductions of the authoritative edition
 *  3 = reputable secondary practitioner sources (blogs, exam-prep sites,
 *      engineering firms). Tier 3 alone is NEVER sufficient to move a rule
 *      out of REQUIRES_SOURCE_VERIFICATION.
 */
export type SourceTier = 1 | 2 | 3;

/** Whether a primary source document has actually been obtained and
 *  authenticated in the workspace sources/ directory.
 */
export type SourceVerificationState =
  | 'obtained-authenticated'   // Tier 1 file present; hash recorded; clauses reviewed
  | 'obtained-unauthenticated' // File present but authenticity / edition not yet confirmed
  | 'not-obtained';            // No local copy (network or permission blocked)

/** Cryptographic digest of a locally-stored document (tamper-evidence). */
export interface SourceDigest {
  algorithm: 'sha256';
  /** Hex-encoded digest. */
  value: string;
}

/** A single clause citation pointing to a RegulationSource. */
export interface SourceRef {
  /** Must match RegulationSource.id in the pack's sourceRegistry. */
  sourceId: string;
  /** Exact clause / section / table reference, e.g. "Mabhas 4 (1396) §7-1-1-8". */
  clause: string;
  /** Optional page number within the document. */
  page?: number;
  /** Optional verbatim quote or paraphrase of the clause text for auditors. */
  snippet?: string;
  /** Note on interpretation / cross-reference / exception. */
  note?: string;
  /** ISO date this citation was last cross-checked against the document. */
  verifiedAt?: string;
}

/** A registered source document (carried in RegulationPack.sourceRegistry). */
export interface RegulationSource {
  /** Stable identifier (e.g. "mabhas-4-1399"). */
  id: string;
  /** Full title (Persian + English where useful). */
  title: string;
  /** Issuing body (e.g. "دفتر مقررات ملی ساختمان، وزارت راه و شهرسازی"). */
  publisher?: string;
  /** Edition label (e.g. "1399 — ویرایش چهارم"). */
  edition?: string;
  publicationDate?: string;
  effectiveDate?: string;
  jurisdiction: 'ir-national' | 'ir-tehran' | 'default' | string;
  tier: SourceTier;
  /** Path relative to the repository root when stored locally (e.g. "sources/mabhas-4-1399.pdf"). */
  documentPath?: string;
  /** Canonical public URI (BHRC / inbr.ir / official publisher). */
  uri?: string;
  /** SHA-256 digest of the local file, when obtained. */
  digest?: SourceDigest;
  /** Whether the document is currently held and authenticated. */
  verificationState: SourceVerificationState;
  /** ISO date this source entry was retrieved/checked. */
  retrievedAt?: string;
  /** Free-text note (e.g. reason Tier 1 is unavailable). */
  note?: string;
}

export type RuleEvaluator = (ctx: RuleContext) => RuleResult | RuleResult[];

export interface RuleContext {
  project: ProjectInput;
  /** Current buildable footprint rectangle on floor 0. */
  footprint: { x: number; y: number; w: number; h: number };
  /** Helper: site dimensions. */
  siteWidth: number;
  siteLength: number;
  siteArea: number;
  /** Candidate (post-generation) for floor-by-floor checks; may be undefined
   *  when the engine is queried for footprint-only data. */
  candidate?: LayoutCandidate;
}

export interface RuleResult {
  pass: boolean;
  severity: Severity;
  code: string;
  message: string;
  /** Numeric value if penalty/dimension is involved. */
  value?: number;
  /** Human-readable citation (clause). */
  reference?: string;
  /** Rule status snapshot at evaluation time (for UI badge). */
  status?: RuleStatus;
  /** Source references backing this finding (for audit trail). */
  sources?: SourceRef[];
  /** IDs of entities this finding refers to (space/wall/opening). */
  entityIds?: string[];
  /** Optional bounding box in metres for UI highlighting. */
  bbox?: [number, number, number, number];
}

export interface RegulationRule {
  ruleId: string;
  jurisdiction: string;   // e.g. "ir-national" or "ir-tehran"
  scope: 'national' | 'local';
  /** Human short title (Persian). */
  title: string;
  /** Human-readable description of the requirement (Persian). */
  description?: string;
  /** Reference / clause, e.g. "Mabhas 4 (1396) §7-1-1-8". */
  reference?: string;
  /** Source references that establish this rule. */
  sources?: SourceRef[];
  /** Publication edition, e.g. "1399 (3rd rev.)". */
  edition?: string;
  /** ISO effective date, if known. */
  effectiveDate?: string;
  /** Worst-case source tier of the rule's backing sources (informs UI badge). */
  sourceTier?: SourceTier;
  status: RuleStatus;
  /** Regulation family (for grouping in audit reports), e.g. "habitable-room" / "stair" / "elevator". */
  family?: string;
  /** Category. */
  category: 'setback' | 'coverage' | 'height' | 'parking' | 'daylight' | 'room' | 'stair' | 'ventilation' | 'access' | 'egress' | 'elevator' | 'corridor' | 'door' | 'sanitary' | 'kitchen';
  severity: Severity;
  /** Numerical thresholds encoded in this rule (auditable). */
  thresholds?: Record<string, { value: number; unit: string; note?: string }>;
  /** Data-driven parameter bag consumed by the evaluator. */
  params?: Record<string, number | string | boolean>;
  /** Evaluator function. If absent, default evaluators are used by category. */
  evaluate?: RuleEvaluator;
}

export interface RegulationPack {
  id: string;              // e.g. "ir-national-mbr" or "ir-tehran"
  jurisdiction: string;    // display name
  scope: 'national' | 'local' | 'default';
  edition: string;
  effectiveDate?: string;
  description?: string;
  /** Source registry: documents this pack is drawn from, keyed by id so
   *  rules can reference them by SourceRef.sourceId without repeating URIs. */
  sourceRegistry?: RegulationSource[];
  /** Legacy field kept for backward compatibility (deprecated — use sourceRegistry). */
  sources?: Array<{ title: string; uri?: string; tier: 'primary-official' | 'secondary-practitioner' | 'assumption-default' }>;
  rules: RegulationRule[];
}

export interface BuildableFootprint {
  /** Setbacks applied (m). */
  setbacks: { north: number; south: number; east: number; west: number };
  /** Resulting buildable rect in site coordinates — legacy compat, bounding rect of buildableBoundary */
  rect: { x: number; y: number; w: number; h: number };
  /** Maximum ground coverage ratio 0..1 if specified. */
  maxCoverage?: number;
  /** Maximum building height if specified. */
  maxHeight?: number;
  /** Which rules were applied (with sources). */
  appliedRules: Array<{ ruleId: string; reference?: string; message: string; status: RuleStatus }>;
  /** Unverified flag — user must verify. */
  requiresSourceVerification: boolean;
  /** Phase 10 — canonical site/buildable geometry */
  siteBoundary?: Array<{ x: number; y: number }>;
  siteArea?: number;
  siteBoundingRect?: { x: number; y: number; w: number; h: number };
  buildableBoundary?: Array<{ x: number; y: number }>;
  buildableArea?: number;
  buildableBoundingRect?: { x: number; y: number; w: number; h: number };
  buildableRects?: Array<{ x: number; y: number; w: number; h: number }>;
  appliedSetbacks?: Array<{ direction: 'north' | 'south' | 'east' | 'west'; value: number; source: 'user-defined' | 'default-assumption' | 'verified'; status: 'VERIFIED' | 'REQUIRES_SOURCE_VERIFICATION' | 'USER_DEFINED' | 'DEFAULT'; reference?: string }>;
  buildableValid?: boolean;
  buildableErrors?: string[];
  siteShape?: string;
}

