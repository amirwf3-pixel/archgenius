/**
 * Space schedule data — ready for XLSX export (Phase 5) or for UI display.
 */
import type { LayoutCandidate } from '../model/layout.js';

export interface SpaceScheduleRow {
  floor: number;
  id: string;
  room: string;
  type: string;
  areaM2: number;
  widthM: number;
  lengthM: number;
  doors: number;
  windows: number;
  orientation: string;
}

export function buildSpaceSchedule(candidate: LayoutCandidate): SpaceScheduleRow[] {
  const rows: SpaceScheduleRow[] = [];
  for (const floor of candidate.floors) {
    for (const s of floor.spaces) {
      const doors = s.openingIds.filter(id => {
        const o = floor.openings.find(x => x.id === id);
        return o && (o.type === 'door' || o.type === 'entrance');
      }).length;
      const windows = s.openingIds.filter(id => {
        const o = floor.openings.find(x => x.id === id);
        return o && o.type === 'window';
      }).length;
      rows.push({
        floor: floor.level,
        id: s.id,
        room: s.label,
        type: s.type,
        areaM2: Math.round(s.area * 100) / 100,
        widthM: Math.round(s.rect.w * 100) / 100,
        lengthM: Math.round(s.rect.h * 100) / 100,
        doors,
        windows,
        orientation: s.orientation ?? 'any',
      });
    }
  }
  return rows;
}
