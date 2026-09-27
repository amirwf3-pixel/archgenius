/**
 * Task 160 — family-room size gate.
 *
 * A family room is a flexible communal room; before Task 160 the upper-floor band
 * filler handed it the whole public band (~80–200 m² for a 12 m² program) and no
 * rule bounded it (only the P17-B ranking penalty, which every strategy shared).
 *
 *   FAMILY_ROOM_OVERSIZED (HARD) — area above the placer's existing M4 area cap
 *     max(1.1·minArea, 1.75·max(target, minArea)); for the family-room program
 *     (target 12 m², min 8 m²) that is 21.0 m².
 *
 * Same convention as BALCONY_OVERSIZED: the Phase 15 M2 gate turns a violation into
 * a deterministic INFEASIBLE result. Sizes come only from programming/program.ts;
 * candidates without a family room produce no findings.
 */
import type { LayoutCandidate } from '../model/layout.js';
import type { Finding } from './types.js';
import { balconyAreaCap } from './balcony.js';

export function validateFamilyRooms(candidate: LayoutCandidate): Finding[] {
  const out: Finding[] = [];
  for (const fl of candidate.floors) {
    for (const s of fl.spaces) {
      if (s.type !== 'family-room') continue;
      const target = s.targetArea ?? 0;
      const min = s.minArea ?? 0;
      if (!(target > 0)) continue;
      const cap = balconyAreaCap(target, min); // the shared M4 cap formula
      if (s.area > cap + 1e-6) {
        out.push({
          code: 'FAMILY_ROOM_OVERSIZED',
          severity: 'hard',
          message: `Floor ${fl.level}: family room '${s.id}' area ${s.area.toFixed(2)} m² exceeds the program cap ${cap.toFixed(2)} m² (target ${target} m²)`,
          ruleId: 'FAMILY_ROOM_SIZE',
          reference: 'Task 160 family-room program bound (placer M4 area cap)',
          status: 'VERIFIED',
          entityIds: [s.id],
        } as Finding);
      }
    }
  }
  return out;
}
