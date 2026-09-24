/**
 * Accessibility — deterministic 2D STEP-FREE ROUTE analysis (standalone).
 *
 * SCOPE / STATUS — read before using the findings:
 *  - The repository holds NO verified accessibility requirement (no accessible
 *    route width, door clear width, turning circle, ramp slope, level-change or
 *    applicability clause). Every finding here is therefore ADVISORY with status
 *    REQUIRES_SOURCE_VERIFICATION: the geometry is measured objectively, but no
 *    compliance requirement is asserted and none is ever reported as passed.
 *  - The absence of findings is NOT an accessibility PASS: clear widths, door
 *    widths, turning spaces, thresholds and ramps are not assessed at all.
 *  - This validator is STANDALONE: it is not merged into validateLayout() or
 *    candidate.findings, so generation, ranking, feasibility and DXF output are
 *    unaffected. Callers opt in via validateAccessibility(candidate).
 *
 * Route model (topological, threshold-free):
 *  - origin: the interior space behind a street-facade entrance door on the
 *    ground floor (same exterior-wall + facade classification as circulation);
 *  - same-floor edges: door / entrance / sliding-door openings joining two spaces
 *    (the same door graph validateCirculation uses);
 *  - vertical edges: ONLY an elevator shaft stacked exactly (same coreId, same
 *    rect) on both floors, joined through its elevator-hall spaces. A stair is
 *    never a step-free edge.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { SourceRef } from '../regulations/types.js';
import type { Finding } from './types.js';
import { wallSide } from '../generator/openings.js';
import { IR_NATIONAL_MBR_PACK } from '../regulations/packs/ir-national-mbr.js';

/** Spaces outside the interior route (same exemption set as CIRC_INACCESSIBLE_SPACE). */
const EXTERIOR_TYPES = new Set(['parking', 'yard', 'balcony']);
const SANITARY_TYPES = new Set(['bathroom', 'master-bathroom', 'guest-wc']);
const DOOR_TYPES = new Set(['door', 'entrance', 'sliding-door']);

const NO_SOURCE_REF =
  'No verified accessibility source in the repository — geometric advisory only (REQUIRES_SOURCE_VERIFICATION); not a compliance check.';

/**
 * Accessible sanitary-space footprint, read from the national pack's MBH4-ROOM-007
 * metadata (thresholds accessible_sanitary_long / accessible_sanitary_short,
 * Mabhas 4 (1396) §4-5-6-2-1, PDF p75) together with that rule's p75 source
 * reference — the value is never duplicated in this module. Only the DIMENSION is
 * verified; which buildings must provide such a space is NOT in the repository,
 * so the related finding stays advisory / REQUIRES_SOURCE_VERIFICATION.
 * Returns null if the pack metadata is absent.
 */
export function accessibleSanitaryFootprint(): { long: number; short: number; sources: SourceRef[] } | null {
  const rule = IR_NATIONAL_MBR_PACK.rules.find(r => r.ruleId === 'MBH4-ROOM-007');
  const long = rule?.thresholds?.accessible_sanitary_long?.value;
  const short = rule?.thresholds?.accessible_sanitary_short?.value;
  if (!rule || typeof long !== 'number' || typeof short !== 'number') return null;
  const sources = (rule.sources ?? []).filter(x => x.sourceId === 't1-mabhas4-96-pdf' && x.page === 75);
  return { long, short, sources };
}

const key = (level: number, id: string) => `${level}\u0000${id}`;
const bboxOf = (r: { x: number; y: number; w: number; h: number }): [number, number, number, number] =>
  [r.x, r.y, r.x + r.w, r.y + r.h];

function advisory(code: string, message: string, entityIds: string[], bbox?: [number, number, number, number], reference = NO_SOURCE_REF, sources?: SourceRef[], value?: number): Finding {
  const f: Finding = { code, severity: 'advisory', message, reference, status: 'REQUIRES_SOURCE_VERIFICATION', entityIds };
  if (bbox) f.bbox = bbox;
  if (sources && sources.length) f.sources = sources;
  if (value !== undefined) (f as Finding & { value?: number }).value = value;
  return f;
}

/** Interior spaces behind a street-facade entrance door on the ground floor. */
function streetOrigins(fl: Floor): Space[] {
  if (!fl.spaces.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of fl.spaces) {
    x0 = Math.min(x0, s.rect.x); y0 = Math.min(y0, s.rect.y);
    x1 = Math.max(x1, s.rect.x + s.rect.w); y1 = Math.max(y1, s.rect.y + s.rect.h);
  }
  const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const byId = new Map(fl.spaces.map(s => [s.id, s]));
  const out: Space[] = [];
  for (const o of fl.openings) {
    if (o.type !== 'entrance') continue;
    const w = fl.walls.find(x => x.id === o.wallId);
    if (!w || w.kind !== 'exterior') continue;
    if (fl.accessSide && wallSide(w, box) !== fl.accessSide) continue;
    const inner = byId.get((w.spaceIds[0] ?? w.spaceIds[1]) as string);
    if (!inner || EXTERIOR_TYPES.has(inner.type)) continue;
    if (!out.includes(inner)) out.push(inner);
  }
  return out;
}

/**
 * Deterministic step-free reachability over the whole building.
 * Returns the set of reached `level\0spaceId` keys (empty when no origin).
 */
export function stepFreeReachable(candidate: LayoutCandidate): { origins: Space[]; reached: Set<string> } {
  const floors = candidate.floors;
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };
  for (const fl of floors) {
    for (const o of fl.openings) {
      if (!DOOR_TYPES.has(o.type)) continue;
      const w = fl.walls.find(x => x.id === o.wallId);
      if (!w) continue;
      const [a, b] = w.spaceIds;
      if (a && b) link(key(fl.level, a), key(fl.level, b));
    }
  }
  // Vertical: exactly stacked elevator shafts only (never stairs).
  const ground = floors.find(f => f.level === 0) ?? floors[0];
  const e0 = ground?.elevators?.[0];
  if (e0) {
    for (const fl of floors) {
      if (fl === ground) continue;
      const e = (fl.elevators ?? []).find(x => x.coreId === e0.coreId);
      if (!e) continue;
      const same = Math.abs(e.rect.x - e0.rect.x) < 1e-6 && Math.abs(e.rect.y - e0.rect.y) < 1e-6
        && Math.abs(e.rect.w - e0.rect.w) < 1e-6 && Math.abs(e.rect.h - e0.rect.h) < 1e-6;
      if (!same) continue;
      link(key(ground.level, e0.hallSpaceId), key(fl.level, e.hallSpaceId));
    }
  }
  const origins = ground ? streetOrigins(ground) : [];
  const reached = new Set<string>();
  const q = origins.map(s => key(ground!.level, s.id));
  for (const k of q) reached.add(k);
  while (q.length) {
    const k = q.shift()!;
    for (const n of adj.get(k) ?? []) if (!reached.has(n)) { reached.add(n); q.push(n); }
  }
  return { origins, reached };
}

/**
 * Standalone accessibility advisory findings (never HARD, never merged into
 * candidate.findings). Deterministic: floors and spaces are reported in model order.
 *
 *  ACC_STEP_FREE_NO_ORIGIN        — no street entrance to start a step-free route from.
 *  ACC_FLOOR_NOT_STEP_FREE        — a floor with no space reachable without stairs.
 *  ACC_SPACE_NOT_STEP_FREE        — a space unreachable without stairs on a floor that is otherwise reached.
 *  ACC_ACCESSIBLE_SANITARY_ABSENT — no step-free-reachable sanitary space fits the accessible footprint from MBH4-ROOM-007 metadata.
 */
export function validateAccessibility(candidate: LayoutCandidate): Finding[] {
  const out: Finding[] = [];
  if (!candidate || !candidate.floors?.length) return out;
  const { origins, reached } = stepFreeReachable(candidate);
  if (origins.length === 0) {
    out.push(advisory('ACC_STEP_FREE_NO_ORIGIN',
      'Accessibility (advisory): no ground-floor street entrance door was found, so no step-free route can be traced — step-free access is UNDETERMINED, not passed.',
      []));
    return out;
  }
  const hasLift = candidate.floors.some(f => (f.elevators ?? []).length > 0);
  for (const fl of candidate.floors) {
    const interior = fl.spaces.filter(s => !EXTERIOR_TYPES.has(s.type));
    if (!interior.length) continue;
    const got = interior.filter(s => reached.has(key(fl.level, s.id)));
    if (got.length === 0) {
      const why = !hasLift
        ? 'the building has no elevator and a stair is never a step-free route'
        : (fl.elevators ?? []).length === 0
          ? 'the elevator does not serve this floor'
          : 'the elevator landing on this floor or on the ground floor is not reachable through doors';
      const fp = fl.footprint;
      out.push(advisory('ACC_FLOOR_NOT_STEP_FREE',
        `Accessibility (advisory): floor ${fl.level} has no step-free route from the street entrance — ${why}.`,
        interior.map(s => s.id), fp ? bboxOf(fp) : undefined, NO_SOURCE_REF, undefined, fl.level));
      continue;
    }
    for (const s of interior) {
      if (reached.has(key(fl.level, s.id))) continue;
      out.push(advisory('ACC_SPACE_NOT_STEP_FREE',
        `Accessibility (advisory): "${s.label}" on floor ${fl.level} is not reachable from the street entrance without stairs.`,
        [s.id], bboxOf(s.rect)));
    }
  }
  // Accessible sanitary footprint (verified dimension, unverified applicability).
  const sanitary: Array<{ s: Space; level: number }> = [];
  for (const fl of candidate.floors) for (const s of fl.spaces) if (SANITARY_TYPES.has(s.type)) sanitary.push({ s, level: fl.level });
  if (sanitary.length) {
    const fp = accessibleSanitaryFootprint();
    if (!fp) {
      // Never a silent omission: the check cannot run without its pack metadata.
      throw new Error('validateAccessibility: MBH4-ROOM-007 accessible_sanitary_long/short metadata is missing from the national regulation pack.');
    }
    const sanitaryRef = `Mabhas 4 (1396) §4-5-6-2-1 — PDF p75: accessible sanitary space ${fp.long.toFixed(2)}×${fp.short.toFixed(2)} m (dimension VERIFIED; applicability REQUIRES_SOURCE_VERIFICATION).`;
    const fits = (s: Space) => Math.min(s.rect.w, s.rect.h) + 1e-6 >= fp.short
      && Math.max(s.rect.w, s.rect.h) + 1e-6 >= fp.long;
    const ok = sanitary.some(({ s, level }) => reached.has(key(level, s.id)) && fits(s));
    if (!ok) {
      const reachedSan = sanitary.filter(({ s, level }) => reached.has(key(level, s.id)));
      const detail = reachedSan.length === 0
        ? 'no sanitary space is reachable without stairs'
        : `step-free-reachable sanitary spaces: ${reachedSan.map(({ s }) => `"${s.label}" ${s.rect.w.toFixed(2)}×${s.rect.h.toFixed(2)} m`).join(', ')}`;
      out.push(advisory('ACC_ACCESSIBLE_SANITARY_ABSENT',
        `Accessibility (advisory): no step-free-reachable sanitary space fits the ${fp.long.toFixed(2)}×${fp.short.toFixed(2)} m accessible footprint recorded in Mabhas 4 §4-5-6-2-1 — ${detail}. Whether this building must provide one is not verified.`,
        sanitary.map(({ s }) => s.id), undefined, sanitaryRef, fp.sources));
    }
  }
  return out;
}
