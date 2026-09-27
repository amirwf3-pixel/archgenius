/**
 * Task 154 — yard validation (only when a yard exists; a MISSING requested yard is
 * reported by program completeness as ARCH_PROGRAM_UNPLACED — existing convention).
 *
 *   YARD_INVALID   (hard) — the yard is not on the ground floor, lies outside the
 *                  buildable polygon, lies under / overlaps any floor's spaces,
 *                  overlaps parking geometry, crosses the ground floor's street-side
 *                  building line, or its area is outside
 *                  [minArea, existing M4 cap max(1.1·min, 1.75·target)].
 *   YARD_NO_ACCESS (hard) — no walkway ≥ CORRIDOR_MIN_WIDTH over open ground joins
 *                  the street edge of the site to the yard.
 *
 * Candidates without a yard produce no findings.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Rect } from '../geometry/rect.js';
import type { Finding } from './types.js';
import { rectInsidePolygon } from '../geometry/polygon-ops.js';
import { yardAreaCap, yardReachable, rectsOverlap, yardCrossesStreetLine } from '../generator/yard.js';

const mk = (code: string, ruleId: string, message: string, id: string): Finding => ({
  code, severity: 'hard', message, ruleId,
  reference: 'Task 154 yard (exterior open space)', status: 'VERIFIED', entityIds: [id],
} as Finding);

export function validateYards(candidate: LayoutCandidate): Finding[] {
  const out: Finding[] = [];
  const allRects = (exceptId: string): Rect[] =>
    candidate.floors.flatMap(f => f.spaces.filter(s => s.id !== exceptId && s.type !== 'yard').map(s => s.rect));
  for (const fl of candidate.floors) {
    for (const s of fl.spaces) {
      if (s.type !== 'yard') continue;
      const problems: string[] = [];
      if (fl.level !== 0) problems.push(`not on the ground floor (level ${fl.level})`);
      const bb = ((candidate as any).buildableBoundary ?? (fl as any).buildableBoundary) as Array<{ x: number; y: number }> | undefined;
      if (Array.isArray(bb) && bb.length >= 3 && !rectInsidePolygon(s.rect, bb, 1e-3)) problems.push('outside the buildable area');
      if (allRects(s.id).some(r => rectsOverlap(s.rect, r))) problems.push('under or overlapping building spaces');
      const parking: Rect[] = [
        ...((fl.parkingStalls ?? []) as any[]).map(p => p.rect as Rect).filter(Boolean),
        ...(fl.parkingArea?.aisleRect ? [fl.parkingArea.aisleRect as Rect] : []),
      ];
      if (parking.some(r => rectsOverlap(s.rect, r))) problems.push('overlapping parking');
      const gr = fl.spaces.filter(x => x.type !== 'yard').map(x => x.rect);
      if (gr.length && fl.accessSide) {
        const gb = gr.reduce((a, r) => ({ x0: Math.min(a.x0, r.x), y0: Math.min(a.y0, r.y), x1: Math.max(a.x1, r.x + r.w), y1: Math.max(a.y1, r.y + r.h) }),
          { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        if (yardCrossesStreetLine(s.rect, { x: gb.x0, y: gb.y0, w: gb.x1 - gb.x0, h: gb.y1 - gb.y0 }, fl.accessSide)) problems.push('on the street side of the building');
      }
      const min = s.minArea ?? 0, target = s.targetArea ?? 0;
      if (target > 0) {
        const cap = yardAreaCap(target, min);
        if (s.area < min - 1e-6) problems.push(`area ${s.area.toFixed(2)} m² below the program minimum ${min} m²`);
        if (s.area > cap + 1e-6) problems.push(`area ${s.area.toFixed(2)} m² above the program cap ${cap.toFixed(2)} m²`);
      }
      if (problems.length) {
        out.push(mk('YARD_INVALID', 'YARD_GEOMETRY', `Floor ${fl.level}: yard '${s.id}' is invalid: ${problems.join('; ')}`, s.id));
      }
      const site = ((candidate as any).siteBoundary ?? (fl as any).siteBoundary) as Array<{ x: number; y: number }> | undefined;
      const ground = candidate.floors.find(f => f.level === 0) ?? fl;
      if (Array.isArray(site) && site.length >= 3) {
        const blockers: Rect[] = [
          ...ground.spaces.filter(x => x.type !== 'yard').map(x => x.rect),
          ...((ground.parkingStalls ?? []) as any[]).map(p => p.rect as Rect).filter(Boolean),
        ];
        const access = (ground.accessSide ?? (candidate as any).siteInput?.accessSide ?? 'south');
        if (!yardReachable(s.rect, { siteBoundary: site, access, groundBlockers: blockers })) {
          out.push(mk('YARD_NO_ACCESS', 'YARD_ACCESS', `Floor ${fl.level}: yard '${s.id}' is not reachable from the street over open ground (walkway ≥ corridor minimum width)`, s.id));
        }
      }
    }
  }
  return out;
}
