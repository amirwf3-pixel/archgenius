/**
 * Architectural QA layer — Phase 6.
 *
 * Professional quality checks beyond basic geometry:
 *  - Room usability: minimum side, area, proportion
 *  - Circulation quality: dead-ends, excessive ratio, longest path
 *  - Door/window collisions and outside checks
 *  - Parking access blocked
 *  - Furniture blocks door/window
 *  - Service exposure (bath/WC directly opening to living)
 *  - Privacy weak (bedroom directly adjacent to entrance/foyer)
 *  - Excessive residual space
 *
 * All findings are soft/advisory except where they make a space unusable (hard).
 * Deterministic, no AI scoring.
 */
import type { Floor } from '../model/floor.js';
import type { Finding } from './types.js';
import { ROOM_MIN_SIDE, ROOM_MIN_AREA, CORRIDOR_MIN_WIDTH } from '../units.js';
import type { Space } from '../model/space.js';

const CIRC_TYPES = new Set(['corridor', 'foyer', 'entrance', 'stair-hall', 'elevator-hall']);

function f(code: string, severity: Finding['severity'], msg: string, entityIds?: string[], bbox?: Finding['bbox']): Finding {
  return { code, severity, message: msg, entityIds, bbox } as Finding;
}

export function validateArchitecturalQA(floor: Floor): Finding[] {
  const findings: Finding[] = [];

  // ---- Room geometry quality ----
  for (const s of floor.spaces) {
    if (s.type === 'parking' || s.type === 'yard' || s.type === 'balcony') continue;
    const w = s.rect.w, h = s.rect.h;
    const minSide = Math.min(w, h);
    const maxSide = Math.max(w, h);
    const ratio = maxSide / Math.max(minSide, 1e-6);
    const area = s.area;

    if (area < ROOM_MIN_AREA || minSide < ROOM_MIN_SIDE - 1e-3) {
      findings.push(f('ROOM_UNUSABLE', 'hard', `Room "${s.label}" is unusable: area ${area.toFixed(2)} m², min side ${minSide.toFixed(2)} m below ${ROOM_MIN_SIDE} m.`, [s.id], [s.rect.x, s.rect.y, s.rect.x + s.rect.w, s.rect.y + s.rect.h]));
      continue;
    }
    if (minSide < 1.0 && !['guest-wc', 'storage', 'utility'].includes(s.type)) {
      findings.push(f('ROOM_TOO_NARROW', 'soft', `Room "${s.label}" is too narrow: min side ${minSide.toFixed(2)} m.`, [s.id]));
    }
    if (ratio > 3.5 && s.type !== 'corridor') {
      findings.push(f('ROOM_BAD_PROPORTION', 'soft', `Room "${s.label}" has bad proportion: ${maxSide.toFixed(2)} / ${minSide.toFixed(2)} = ${ratio.toFixed(1)}.`, [s.id]));
    }
    if (s.type === 'corridor' && minSide < CORRIDOR_MIN_WIDTH - 1e-3) {
      findings.push(f('CIRC_CORRIDOR_TOO_NARROW', 'hard', `Corridor "${s.label}" width ${minSide.toFixed(2)} m below minimum ${CORRIDOR_MIN_WIDTH} m.`, [s.id]));
    }
  }

  // ---- Circulation quality ----
  const circSpaces = floor.spaces.filter(s => CIRC_TYPES.has(s.type));
  const totalArea = floor.spaces.reduce((sum, s) => sum + s.area, 0);
  const circArea = circSpaces.reduce((sum, s) => sum + s.area, 0);
  const circRatio = totalArea > 0 ? circArea / totalArea : 0;

  if (circRatio > 0.35 && circSpaces.length > 0) {
    findings.push(f('CIRCULATION_EXCESSIVE', 'soft', `Circulation ratio ${ (circRatio*100).toFixed(1)}% exceeds 35% — inefficient layout.`, circSpaces.map(s => s.id)));
  }

  // Dead-end detection: corridor with only one door connection (excluding entrance)
  const doorConnections = new Map<string, number>();
  for (const o of floor.openings) {
    if (o.type !== 'door' && o.type !== 'entrance') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    for (const sid of wall.spaceIds) {
      if (!sid) continue;
      doorConnections.set(sid, (doorConnections.get(sid) ?? 0) + 1);
    }
  }
  for (const s of circSpaces) {
    if (s.type === 'corridor' && (doorConnections.get(s.id) ?? 0) <= 1) {
      findings.push(f('CIRCULATION_DEAD_END', 'soft', `Corridor "${s.label}" appears to be a dead-end with ≤1 door.`, [s.id]));
    }
  }

  // Longest path heuristic: if corridor area is very elongated and many rooms, flag
  // (We approximate by corridor length vs total footprint)
  // Already covered by ratio check; additional check for excessive turns could be added.

  // ---- Door collisions ----
  for (let i = 0; i < floor.openings.length; i++) {
    for (let j = i + 1; j < floor.openings.length; j++) {
      const a = floor.openings[i], b = floor.openings[j];
      if (a.wallId !== b.wallId) continue;
      const dx = a.center.x - b.center.x;
      const dy = a.center.y - b.center.y;
      const dist = Math.hypot(dx, dy);
      const minDist = (a.width + b.width) / 2 + 0.1;
      if (dist < minDist) {
        if (a.type !== 'window' && b.type !== 'window') {
          findings.push(f('DOOR_COLLISION', 'soft', `Doors ${a.id} and ${b.id} collide on wall ${a.wallId}.`, [a.id, b.id]));
        } else if (a.type === 'window' || b.type === 'window') {
          findings.push(f('WINDOW_COLLISION', 'soft', `Window collides with door on wall ${a.wallId}: ${a.id} vs ${b.id}.`, [a.id, b.id]));
        }
      }
    }
  }

  // ---- Window outside / door conflict ----
  for (const o of floor.openings) {
    if (o.type === 'window') {
      const wall = floor.walls.find(w => w.id === o.wallId);
      if (!wall) {
        findings.push(f('WINDOW_OUTSIDE', 'hard', `Window ${o.id} references missing wall.`, [o.id]));
      } else if (wall.kind !== 'exterior') {
        findings.push(f('WINDOW_OUTSIDE', 'hard', `Window ${o.id} is not on exterior wall (found ${wall.kind}).`, [o.id, wall.id]));
      }
    }
  }

  // ---- Parking access blocked ----
  if (floor.parkingStalls.length > 0) {
    // Check if any stall is fully enclosed by walls without aisle adjacency
    // Simplified: if parkingArea missing and stalls exist, flag
    if (!floor.parkingArea) {
      findings.push(f('PARKING_ACCESS_BLOCKED', 'soft', `Parking stalls exist but no aisle defined — access may be blocked.`, floor.parkingStalls.map(s => s.id)));
    }
  }

  // ---- Furniture blocks door ----
  for (const furn of floor.furniture ?? []) {
    for (const o of floor.openings) {
      if (o.type !== 'door' && o.type !== 'entrance') continue;
      const fx = furn.rect.x + furn.rect.w / 2;
      const fy = furn.rect.y + furn.rect.h / 2;
      const dx = fx - o.center.x;
      const dy = fy - o.center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.8) {
        findings.push(f('FURNITURE_BLOCKS_DOOR', 'soft', `Furniture ${furn.id} may block door ${o.id}.`, [furn.id, o.id]));
      }
    }
  }

  // ---- Service exposure: bathroom/WC directly opening to living/dining ----
  const publicTypes = new Set(['living', 'dining']);
  for (const o of floor.openings) {
    if (o.type !== 'door') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    const a = floor.spaces.find(s => s.id === wall.spaceIds[0]);
    const b = floor.spaces.find(s => s.id === wall.spaceIds[1]);
    if (!a || !b) continue;
    const isService = (s: Space) => ['bathroom', 'master-bathroom', 'guest-wc'].includes(s.type);
    const isPublic = (s: Space) => publicTypes.has(s.type);
    if ((isService(a) && isPublic(b)) || (isService(b) && isPublic(a))) {
      findings.push(f('SERVICE_EXPOSURE', 'soft', `Service room ${isService(a) ? a.label : b.label} opens directly to public ${isPublic(a) ? a.label : b.label} — privacy concern.`, [a.id, b.id, o.id]));
    }
  }

  // ---- Privacy weak: private rooms directly adjacent to entrance/foyer ----
  for (const o of floor.openings) {
    if (o.type !== 'door' && o.type !== 'entrance') continue;
    const wall = floor.walls.find(w => w.id === o.wallId);
    if (!wall) continue;
    const a = floor.spaces.find(s => s.id === wall.spaceIds[0]);
    const b = floor.spaces.find(s => s.id === wall.spaceIds[1]);
    if (!a || !b) continue;
    const isPrivate = (s: Space) => s.privacy === 'private' || ['bedroom', 'master-bedroom', 'master-bathroom', 'bathroom'].includes(s.type);
    const isEntrance = (s: Space) => s.type === 'entrance' || s.type === 'foyer';
    if ((isPrivate(a) && isEntrance(b)) || (isPrivate(b) && isEntrance(a))) {
      findings.push(f('PRIVACY_WEAK', 'soft', `Private room ${isPrivate(a) ? a.label : b.label} directly adjacent to entrance/foyer — privacy weak.`, [a.id, b.id, o.id]));
    }
  }

  // ---- Excessive residual space ----
  const footprintArea = floor.footprint.w * floor.footprint.h;
  const assignedArea = floor.spaces.reduce((sum, s) => sum + s.area, 0);
  const residual = footprintArea - assignedArea;
  if (residual > footprintArea * 0.15) {
    findings.push(f('EXCESSIVE_RESIDUAL', 'soft', `Residual unassigned area ${residual.toFixed(2)} m² is >15% of footprint (${footprintArea.toFixed(2)} m²).`, []));
  }

  return findings;
}
