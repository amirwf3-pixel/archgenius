/**
 * P17-C — deterministic post-placement floor-envelope compaction.
 *
 * Root cause fixed here: the generator declared `floor.footprint` as the FULL
 * buildable rect regardless of the placed program, so any program smaller than
 * the buildable envelope left a large interior area that was counted "inside
 * the floor" while containing no built geometry (the P17-A audited ~50 m²
 * deep-narrow northern void and the ~99 m² two-floor east strip).
 *
 * `applyFloorCompaction` runs AFTER placement (rooms, cores, parking, walls,
 * openings) and shrinks `floor.footprint` to the bounding box of the
 * actually-placed geometry, intersected with the previous footprint. It never
 * moves, resizes or deletes any room; it never touches the site, the
 * buildable boundary or the candidate-level buildableArea (site authority is
 * preserved); per-floor results are independent, so floors with materially
 * different programs get different occupied envelopes while every placed
 * stair/core rect stays exactly where the generator put it (vertical coherence
 * is a placement concern, untouched here).
 *
 * Safety: when the compacted box would be degenerate or would not contain
 * every placed space (the `GEO_ROOM_OUTSIDE_FOOTPRINT` invariant), the original
 * footprint is kept unchanged — an honest fallback instead of corrupted
 * geometry. The whole step is pure floating-point arithmetic on existing
 * coordinates: deterministic by construction.
 */
import type { Floor } from '../model/floor.js';
import type { Rect } from '../geometry/rect.js';

const EPS = 1e-9;

function rectArea(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

function rectContains(outer: Rect, inner: Rect, eps = 1e-3): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

/** Occupied built-geometry rects on a floor: rooms (all types), cores, parking. */
function occupiedRects(floor: Floor): Rect[] {
  const out: Rect[] = [];
  for (const s of floor.spaces ?? []) {
    if (s?.rect && s.rect.w > 0 && s.rect.h > 0) out.push(s.rect);
  }
  for (const st of floor.stairs ?? []) {
    const r = (st as any)?.footprint ?? (st as any)?.rect;
    if (r && r.w > 0 && r.h > 0) out.push(r as Rect);
  }
  for (const p of floor.parkingStalls ?? []) {
    if (p?.rect && p.rect.w > 0 && p.rect.h > 0) out.push(p.rect);
  }
  const pa: any = floor.parkingArea;
  if (pa?.aisleRect && pa.aisleRect.w > 0 && pa.aisleRect.h > 0) out.push(pa.aisleRect as Rect);
  return out;
}

/**
 * Bounding box of all placed geometry (including wall thickness so the
 * declared envelope honestly contains the built walls).
 */
function occupiedBounds(floor: Floor): Rect | null {
  const rects = occupiedRects(floor);
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  let wallPad = 0;
  for (const w of floor.walls ?? []) {
    if (!w?.start || !w?.end) continue;
    wallPad = Math.max(wallPad, (w.thickness ?? 0) / 2);
  }
  return { x: minX - wallPad, y: minY - wallPad, w: maxX - minX + 2 * wallPad, h: maxY - minY + 2 * wallPad };
}

/**
 * Shrink `floor.footprint` to the placed-geometry bounding box (clipped to the
 * current footprint). Returns true when the footprint was compacted, false
 * when the original envelope was kept (no geometry, degenerate result, or the
 * containment invariant would break).
 */
export function applyFloorCompaction(floor: Floor): boolean {
  const current = floor?.footprint;
  if (!current || !(current.w > 0) || !(current.h > 0)) return false;
  const occ = occupiedBounds(floor);
  if (!occ) return false; // nothing placed — keep the declared envelope
  // clip to the current footprint (never grow, never leave the buildable rect)
  const x0 = Math.max(occ.x, current.x);
  const y0 = Math.max(occ.y, current.y);
  const x1 = Math.min(occ.x + occ.w, current.x + current.w);
  const y1 = Math.min(occ.y + occ.h, current.y + current.h);
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0.01) || !(h > 0.01)) return false; // degenerate — fallback
  const compacted: Rect = { x: x0, y: y0, w, h };
  if (rectArea(compacted) >= rectArea(current) - 1e-6) return false; // no meaningful shrink
  // safety: every placed space must still sit inside the compacted envelope
  for (const s of floor.spaces ?? []) {
    if (!s?.rect || !(s.rect.w > 0) || !(s.rect.h > 0)) continue;
    if (!rectContains(compacted, s.rect)) return false; // unsafe — keep original
  }
  floor.footprint = compacted;
  return true;
}
