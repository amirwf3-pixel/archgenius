/**
 * Deterministic candidate ranking — Phase 6 Professional.
 *
 * Ranking is lexicographic by tier (lower tier wins; within a tier lower is
 * better). Tiers are listed below from highest-priority to lowest:
 *
 *   1. HARD feasibility (geometric + circulation + regulation hards + ROOM_UNUSABLE)
 *   2. Geometric validity (soft geometry issues: GEO_, OPENING_, ROOM_TOO_NARROW, BAD_PROPORTION)
 *   3. Required adjacency satisfaction (MUST_BE_ADJACENT / DIRECT_ACCESS)
 *   4. Accessibility / circulation graph score (CIRC_*, dead-ends, excessive residual)
 *   5. Room target deviation (area + dimension)
 *   6. Usable area ratio / circulation ratio (efficiency) + bad proportion count
 *   7. Soft preferences (orientation, daylight, privacy, service exposure)
 *
 * Formula:
 *   hardCount = count of severity=hard
 *   geoSoft = GEO_/OPENING_/ROOM_TOO_NARROW/ROOM_BAD_PROPORTION soft count
 *   hardAdj = ARCH_ADJACENCY_VIOLATION hard count
 *   circulationFailures = CIRC_* + CIRCULATION_DEAD_END + EXCESSIVE_RESIDUAL soft count
 *   roomAreaDeviation = metrics.roomAreaDeviation
 *   wastedArea = metrics.wastedArea
 *   circulationRatio = metrics.circulationRatio
 *   softPreferencePenalty = (1-adj)*10 + (1-daylight)*5 + (1-orient)*3 + (1-privacy)*4 + badProp*0.5 + deadEnds*1 + serviceExposure*2
 *
 * No arbitrary "AI score" is produced. A candidate with any HARD finding
 * will rank strictly below any candidate with zero HARD findings.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from '../validation/types.js';
import type { Floor } from '../model/floor.js';
import type { Space } from '../model/space.js';
import type { Rect } from '../geometry/rect.js';
import { pointInPolygon } from '../geometry/polygon.js';

export interface RankingVector {
  hardCount: number;
  dimensionalSoft: number;
  proportionFailures: number;
  daylightQualityFailures: number;
  doorFailures: number;
  hardAdjacencyFailures: number;
  circulationFailures: number;
  furnitureFailures: number;
  roomAreaDeviation: number;
  wastedArea: number;
  circulationRatio: number;
  softPreferencePenalty: number;
  /** P17-B: architectural-form quality penalty (contiguous floor voids, communal
   *  oversizing, corridor proportion). Continuous, lower is better, deterministic. */
  architecturalQualityPenalty: number;
}

// ---- P17-B architectural quality penalties (ranking ONLY — no geometry changes) ----

/** Communal rooms eligible for the oversizing penalty (flexible rooms that absorb leftovers). */
const P17_COMMUNAL_TYPES = new Set(['living', 'dining', 'family-room']);
/** Oversizing up to this ratio of the requested target is normal modest oversizing — never penalized. */
const P17_COMMUNAL_RATIO = 2.0;
/** Penalty weight per unit of target-ratio beyond the threshold. */
const P17_COMMUNAL_WEIGHT = 1.5;
/** Corridor aspect ratio above this is penalized (corridors are exempt from room-proportion rules). */
const P17_CORRIDOR_AR = 8.0;
/** Corridor longer than this fraction of the floor's long side is penalized (single-loaded strips). */
const P17_CORRIDOR_LEN_FRACTION = 0.75;
/** Contiguous uncovered floor-envelope areas up to this size are intentional voids — never penalized. */
const P17_VOID_ALLOWANCE_M2 = 8;
/** Penalty weight per m² of contiguous void beyond the allowance. */
const P17_VOID_WEIGHT = 0.15;
/** Void scan grid step (m). Coarse by design: deterministic and cheap; wall thickness absorbs sub-cell noise. */
const P17_VOID_CELL = 0.5;

/** Sum of communal-room oversizing penalties: (area/target − 2)+ × 1.5 per living/dining/family room. */
function communalOversizePenalty(spaces: Space[]): number {
  let p = 0;
  for (const s of spaces) {
    if (!P17_COMMUNAL_TYPES.has(s.type as string)) continue;
    const target = (s as any).targetArea;
    const area = (s as any).area;
    if (!(target > 0) || !(area >= 0)) continue; // sparse fixtures without metrics are not penalized
    p += Math.max(0, area / target - P17_COMMUNAL_RATIO) * P17_COMMUNAL_WEIGHT;
  }
  return p;
}

/**
 * Corridor proportion penalty: aspect ratio beyond 8 and length beyond 75% of the
 * floor's long side. Continuous; never rejects a plan by itself.
 */
function corridorProportionPenalty(spaces: Space[], footprint: Rect | undefined): number {
  const longSide = footprint ? Math.max(footprint.w, footprint.h) : 0;
  let p = 0;
  for (const s of spaces) {
    if (s.type !== 'corridor') continue;
    const r = s.rect;
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    const ar = Math.max(r.w, r.h) / Math.min(r.w, r.h);
    p += Math.max(0, ar - P17_CORRIDOR_AR) * 0.5;
    if (longSide > 0) p += Math.max(0, Math.max(r.w, r.h) / longSide - P17_CORRIDOR_LEN_FRACTION) * 2;
  }
  return p;
}

/**
 * Largest contiguous uncovered floor-envelope area (grid scan + BFS, deterministic),
 * penalized only beyond the small-void allowance. Parking/yard/balcony spaces count
 * as intentional open area and cover the grid like rooms do.
 */
function contiguousVoidPenalty(fl: Floor): number {
  const fp = fl.footprint;
  if (!fp || !(fp.w > 0) || !(fp.h > 0)) return 0;
  const cols = Math.floor(fp.w / P17_VOID_CELL);
  const rows = Math.floor(fp.h / P17_VOID_CELL);
  if (cols < 1 || rows < 1 || cols * rows > 250000) return 0; // absurd footprint — skip scan
  const covered = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = fp.x + (c + 0.5) * P17_VOID_CELL;
      const y = fp.y + (r + 0.5) * P17_VOID_CELL;
      let inside = false;
      for (const s of fl.spaces) {
        const rect = s.rect;
        if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) { inside = true; break; }
        const poly = (s as any).polygon;
        if (Array.isArray(poly) && poly.length >= 3 && pointInPolygon({ x, y }, poly)) { inside = true; break; }
      }
      if (inside) covered[r * cols + c] = 1;
    }
  }
  // BFS for the largest uncovered component (4-neighbourhood); size is order-independent.
  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let largest = 0;
  for (let start = 0; start < covered.length; start++) {
    if (covered[start] || seen[start]) continue;
    let head = 0, tail = 0, count = 0;
    seen[start] = 1; queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      count++;
      const r = Math.floor(idx / cols), c = idx % cols;
      if (r > 0 && !covered[idx - cols] && !seen[idx - cols]) { seen[idx - cols] = 1; queue[tail++] = idx - cols; }
      if (r + 1 < rows && !covered[idx + cols] && !seen[idx + cols]) { seen[idx + cols] = 1; queue[tail++] = idx + cols; }
      if (c > 0 && !covered[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; queue[tail++] = idx - 1; }
      if (c + 1 < cols && !covered[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; queue[tail++] = idx + 1; }
    }
    if (count > largest) largest = count;
  }
  const voidM2 = largest * P17_VOID_CELL * P17_VOID_CELL;
  return Math.max(0, voidM2 - P17_VOID_ALLOWANCE_M2) * P17_VOID_WEIGHT;
}

/** Total P17-B quality penalty across all floors. Deterministic, geometry-derived. */
function architecturalQualityPenalty(c: LayoutCandidate): number {
  let p = 0;
  for (const fl of c.floors ?? []) {
    p += communalOversizePenalty(fl.spaces ?? []);
    p += corridorProportionPenalty(fl.spaces ?? [], fl.footprint);
    p += contiguousVoidPenalty(fl);
  }
  return p;
}

export function rankVector(c: LayoutCandidate): RankingVector {
  let hard = 0;
  let dimensionalSoft = 0;
  let proportionFailures = 0;
  let daylightQual = 0;
  let doorFailures = 0;
  let circFail = 0;
  let furnitureFailures = 0;
  let serviceExposure = 0, privacyWeak = 0, windowColl = 0;
  for (const f of c.findings) {
    if (f.severity === 'hard') {
      hard++;
      continue;
    }
    if (f.severity !== 'soft') continue;
    const code: string = f.code as string;
    // Dimensional validity: GEO_* , SITE_* (non-furniture), ROOM_TOO_NARROW, ROOM_UNUSABLE, MBH4-ROOM (regulation dimensional)
    if (
      code.startsWith('GEO_') ||
      code === 'ROOM_TOO_NARROW' ||
      code === 'ROOM_UNUSABLE' ||
      code.startsWith('SITE_ROOM_OUTSIDE') ||
      code.startsWith('SITE_WALL_OUTSIDE') ||
      code.startsWith('SITE_OPENING') ||
      code.startsWith('MBH4-ROOM')
    ) {
      if (code !== 'ROOM_BAD_PROPORTION') dimensionalSoft++;
    }
    if (code === 'ROOM_BAD_PROPORTION' || code === 'ROOM_CONSTRAINT_ASPECT_RATIO') {
      proportionFailures++;
    }
    if (code === 'ROOM_DAYLIGHT_QUALITY') {
      daylightQual++;
    }
    if (
      code === 'OPENING_DOOR_SWING_BLOCKED' ||
      code === 'OPENING_DOOR_COLLISION' ||
      code === 'OPENING_WINDOW_COLLISION' ||
      code === 'DOOR_COLLISION' ||
      code === 'DOOR_SWING_CONFLICT' ||
      code === 'WINDOW_COLLISION' ||
      code === 'WINDOW_OUTSIDE' ||
      code === 'WINDOW_DOOR_CONFLICT'
    ) {
      doorFailures++;
    }
    if (code.startsWith('CIRC_') || code === 'CIRCULATION_DEAD_END' || code === 'CIRCULATION_EXCESSIVE' || code === 'EXCESSIVE_RESIDUAL') {
      circFail++;
    }
    if (code === 'SERVICE_EXPOSURE') serviceExposure++;
    if (code === 'PRIVACY_WEAK') privacyWeak++;
    if (code === 'WINDOW_COLLISION' || code === 'WINDOW_OUTSIDE') windowColl++;
  }
  furnitureFailures = c.findings.filter(f => f.severity === 'soft' && (
    (f.code as string).startsWith('FURNITURE') ||
    (f.code as string).startsWith('FURN_') ||
    (f.code as string) === 'FURN_COLLISION' ||
    (f.code as string) === 'FURN_CLEARANCE_BLOCKED'
  )).length;

  const hardAdj = c.findings.filter(f => f.severity === 'hard' && f.code === 'ARCH_ADJACENCY_VIOLATION').length;

  // Required-spaces tier: missing essential types on the primary (ground) floor.
  // For villa/apartment the ground floor must contain living+kitchen+corridor+entrance;
  // upper floors are exempt for kitchen. We detect missing kitchen/living/corridor/entrance
  // directly from floor 0 spaces — a missing essential type is treated as a required-space failure
  // before dimensional validity, so a candidate missing a kitchen can never outrank one that has it
  // even if the former is slightly better on proportions.
  let requiredMissing = 0;
  try {
    const ground = c.floors.find(fl => fl.level === 0) ?? c.floors[0];
    if (ground) {
      const types = new Set(ground.spaces.map((s: any) => s.type as string));
      const needKitchen = true; // all villa/apartment programs require a kitchen on ground
      if (needKitchen && !types.has('kitchen')) requiredMissing++;
      if (!types.has('living')) requiredMissing++;
      if (!types.has('corridor')) requiredMissing++;
      if (!types.has('entrance') && !types.has('foyer')) requiredMissing++;
    }
  } catch { /* ignore */ }

  const badProp = c.metrics.badProportionCount ?? 0;
  const deadEnds = c.metrics.deadEndCount ?? c.findings.filter(f => f.code === 'CIRCULATION_DEAD_END').length;
  return {
    hardCount: hard,
    dimensionalSoft: dimensionalSoft + requiredMissing * 10, // weight missing essential heavily in dimensional tier
    proportionFailures,
    daylightQualityFailures: daylightQual,
    doorFailures,
    hardAdjacencyFailures: hardAdj,
    circulationFailures: circFail,
    furnitureFailures,
    roomAreaDeviation: c.metrics.roomAreaDeviation,
    wastedArea: c.metrics.wastedArea,
    circulationRatio: c.metrics.circulationRatio,
    softPreferencePenalty:
      (1 - c.metrics.adjacencySatisfaction) * 10 +
      (1 - c.metrics.daylightExposure) * 5 +
      (1 - c.metrics.orientationSatisfaction) * 3 +
      (1 - c.metrics.privacySatisfaction) * 4 +
      badProp * 0.5 +
      daylightQual * 0.75 +
      deadEnds * 1 +
      serviceExposure * 2 +
      privacyWeak * 1.5 +
      windowColl * 1,
    architecturalQualityPenalty: architecturalQualityPenalty(c),
  };
}

/** Returns negative if a ranks better than b, positive otherwise. Deterministic. */
export function compareCandidates(a: LayoutCandidate, b: LayoutCandidate): number {
  const va = rankVector(a), vb = rankVector(b);
  // Tier 1: HARD feasibility
  if (va.hardCount !== vb.hardCount) return va.hardCount - vb.hardCount;
  // Tier 2: dimensional validity (soft geometric)
  if (va.dimensionalSoft !== vb.dimensionalSoft) return va.dimensionalSoft - vb.dimensionalSoft;
  // Tier 3: hard adjacency (required spaces)
  if (va.hardAdjacencyFailures !== vb.hardAdjacencyFailures) return va.hardAdjacencyFailures - vb.hardAdjacencyFailures;
  // Tier 4: room proportions
  if (va.proportionFailures !== vb.proportionFailures) return va.proportionFailures - vb.proportionFailures;
  // Tier 4b (P16-C): daylight quality — deep habitable rooms past the 7 m healthy
  // window depth are ranked below proportionally sound alternatives.
  if (va.daylightQualityFailures !== vb.daylightQualityFailures) return va.daylightQualityFailures - vb.daylightQualityFailures;
  // Tier 5: door validity
  if (va.doorFailures !== vb.doorFailures) return va.doorFailures - vb.doorFailures;
  // Tier 6: circulation
  if (va.circulationFailures !== vb.circulationFailures) return va.circulationFailures - vb.circulationFailures;
  // Tier 7: furniture clearance
  if (va.furnitureFailures !== vb.furnitureFailures) return va.furnitureFailures - vb.furnitureFailures;
  // Tier 7b (P17-B): architectural-form quality — contiguous floor voids, communal
  // oversizing, corridor proportion. Continuous geometry-derived penalties; a plan
  // with a large walled-off void or an absorbing oversized living room ranks below
  // a form-sound alternative. Never creates hard findings and never rejects alone.
  if (Math.abs(va.architecturalQualityPenalty - vb.architecturalQualityPenalty) > 1e-6)
    return va.architecturalQualityPenalty - vb.architecturalQualityPenalty;
  // Tier 8: architectural efficiency — area deviation, then waste, then circ ratio
  if (Math.abs(va.roomAreaDeviation - vb.roomAreaDeviation) > 1e-6) return va.roomAreaDeviation - vb.roomAreaDeviation;
  if (Math.abs(va.wastedArea - vb.wastedArea) > 1e-6) return va.wastedArea - vb.wastedArea;
  if (Math.abs(va.circulationRatio - vb.circulationRatio) > 1e-6) return va.circulationRatio - vb.circulationRatio;
  // Tier 9: secondary optimization
  if (Math.abs(va.softPreferencePenalty - vb.softPreferencePenalty) > 1e-6)
    return va.softPreferencePenalty - vb.softPreferencePenalty;
  // Deterministic tie-breaker by id
  return a.id.localeCompare(b.id);
}

/** Sort candidates in place from best to worst. */
export function sortCandidates(candidates: LayoutCandidate[]): LayoutCandidate[] {
  return candidates.sort(compareCandidates);
}
