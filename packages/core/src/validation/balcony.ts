/**
 * Task 152 — balcony validation (minimum needed for an enabled balcony).
 *
 * Balconies are exempt from the generic circulation / access / daylight checks
 * (they are exterior spaces), which let a doorless or band-sized "balcony" pass as
 * valid. Two HARD checks close that gap, following the program-completeness
 * convention so the Phase 15 M2 gate turns a violation into a deterministic
 * INFEASIBLE result:
 *
 *   BALCONY_NO_ACCESS  — no door joins the balcony to an adjacent circulation
 *                        space or habitable room.
 *   BALCONY_OVERSIZED  — area above the placer's existing M4 area cap
 *                        max(1.1·minArea, 1.75·max(target, minArea)) (the same
 *                        tolerance every banded room is held to). For the default
 *                        balcony program (target 4 m², min 2 m²) that is 7.0 m².
 *
 * No new dimensions or regulatory claims: sizes come from the balcony program in
 * programming/program.ts. Candidates without balconies produce no findings.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from './types.js';

/** Spaces a balcony may legitimately open from (mirrors the openings.ts partners). */
export const BALCONY_ACCESS_PARTNER_TYPES = new Set([
  'corridor', 'foyer', 'stair-hall',
  'living', 'dining', 'family-room', 'guest-room',
  'bedroom', 'master-bedroom',
]);

const DOOR_TYPES = new Set(['door', 'sliding-door', 'entrance']);

/** Existing placer M4 area cap (layout/placer.ts), applied to one space. */
export function balconyAreaCap(targetArea: number, minArea: number): number {
  return Math.max(minArea * 1.1, Math.max(targetArea, minArea) * 1.75);
}

export function validateBalconies(candidate: LayoutCandidate): Finding[] {
  const out: Finding[] = [];
  for (const fl of candidate.floors) {
    const byId = new Map(fl.spaces.map(s => [s.id, s]));
    for (const s of fl.spaces) {
      if (s.type !== 'balcony') continue;
      const accessed = fl.openings.some(o => {
        if (!DOOR_TYPES.has(o.type)) return false;
        const otherId = o.spaceA === s.id ? o.spaceB : o.spaceB === s.id ? o.spaceA : undefined;
        const other = otherId ? byId.get(otherId) : undefined;
        return !!other && BALCONY_ACCESS_PARTNER_TYPES.has(other.type);
      });
      if (!accessed) {
        out.push({
          code: 'BALCONY_NO_ACCESS',
          severity: 'hard',
          message: `Floor ${fl.level}: balcony '${s.id}' has no door from an adjacent circulation space or habitable room`,
          ruleId: 'BALCONY_ACCESS',
          reference: 'Task 152 balcony access',
          status: 'VERIFIED',
          entityIds: [s.id],
        } as Finding);
      }
      const target = s.targetArea ?? 0;
      const min = s.minArea ?? 0;
      if (target > 0) {
        const cap = balconyAreaCap(target, min);
        if (s.area > cap + 1e-6) {
          out.push({
            code: 'BALCONY_OVERSIZED',
            severity: 'hard',
            message: `Floor ${fl.level}: balcony '${s.id}' area ${s.area.toFixed(2)} m² exceeds the program cap ${cap.toFixed(2)} m² (target ${target} m²)`,
            ruleId: 'BALCONY_SIZE',
            reference: 'Task 152 balcony program bound (placer M4 area cap)',
            status: 'VERIFIED',
            entityIds: [s.id],
          } as Finding);
        }
      }
    }
  }
  return out;
}
