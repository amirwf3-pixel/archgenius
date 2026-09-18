/**
 * Phase 8 - Furniture & Usability Intelligence
 *
 * Upgrades furniture QA into functional usability evaluation.
 * Evaluates bed, wardrobe, sofa, dining, kitchen work zone, clearance, door conflicts, window relationship.
 */

import type { Floor } from '../model/floor.js';
import type { Finding } from '../validation/types.js';
import type { FurnitureEvaluation, FurnitureUsability } from './types.js';
import { rOverlapArea, rContains } from '../geometry/rect.js';

function hasDoorConflict(furn: any, floor: Floor): boolean {
  for (const o of floor.openings) {
    if (o.type === 'window') continue;
    const dx = (furn.rect.x + furn.rect.w / 2) - o.center.x;
    const dy = (furn.rect.y + furn.rect.h / 2) - o.center.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.8) return true;
  }
  return false;
}

function windowRelationship(roomId: string, floor: Floor): number {
  const hasWindow = floor.openings.some(o => o.type === 'window' && (o.spaceA === roomId || o.spaceB === roomId));
  return hasWindow ? 1 : 0.5;
}

export function evaluateFurniture(floor: Floor): FurnitureEvaluation {
  const findings: Finding[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const rooms: FurnitureUsability[] = [];

  for (const s of floor.spaces) {
    if (['parking', 'yard', 'balcony', 'corridor', 'stair-hall', 'elevator-hall', 'entrance', 'foyer'].includes(s.type)) continue;
    const furns = floor.furniture.filter(f => f.spaceId === s.id);
    const issues: string[] = [];

    let bedPlacementScore = 1, bedAccessScore = 1, wardrobeAccessScore = 1, doorClearanceScore = 1, circulationScore = 1, windowRelationshipScore = windowRelationship(s.id, floor);
    let sofaArrangementScore = 1, tableClearanceScore = 1, workZoneScore = 1, counterContinuityScore = 1;

    // Check door conflicts
    for (const furn of furns) {
      if (hasDoorConflict(furn, floor)) {
        doorClearanceScore -= 0.3;
        issues.push(`${furn.type} may block door`);
        findings.push({ code: 'FURNITURE_BLOCKS_DOOR', severity: 'soft', message: `Furniture ${furn.id} blocks door in ${s.label}`, entityIds: [furn.id, s.id] } as Finding);
      }
      // Check furniture inside room already validated, but double-check
      if (!rContains(s.rect, furn.rect, 0.01)) {
        issues.push(`${furn.type} outside room`);
        findings.push({ code: 'FURN_OUTSIDE_ROOM', severity: 'hard', message: `${furn.type} outside ${s.label}`, entityIds: [furn.id, s.id] } as Finding);
      }
    }

    // Overlap check
    for (let i = 0; i < furns.length; i++) {
      for (let j = i + 1; j < furns.length; j++) {
        if (rOverlapArea(furns[i].rect, furns[j].rect) > 1e-3) {
          issues.push(`furniture collision ${furns[i].type} vs ${furns[j].type}`);
          findings.push({ code: 'FURN_COLLISION', severity: 'soft', message: `Collision in ${s.label}`, entityIds: [furns[i].id, furns[j].id] } as Finding);
        }
      }
    }

    // Type-specific
    if (s.type === 'bedroom' || s.type === 'master-bedroom') {
      const hasBed = furns.some(f => f.type.includes('bed'));
      const hasWardrobe = furns.some(f => f.type === 'wardrobe');
      if (!hasBed) {
        bedPlacementScore = 0.5;
        issues.push('no bed placed');
      }
      if (!hasWardrobe) {
        wardrobeAccessScore = 0.6;
        issues.push('no wardrobe');
      }
      // Bed access: should have clearance front
      const bed = furns.find(f => f.type.includes('bed'));
      if (bed && bed.clearanceFront && bed.clearanceFront < 0.6) {
        bedAccessScore = 0.7;
        issues.push('bed clearance small');
      }
      // Circulation around furniture: room should have at least 0.9m free on one side
      const minSide = Math.min(s.rect.w, s.rect.h);
      if (minSide < 2.5) circulationScore = 0.6;
    }

    if (s.type === 'living') {
      const hasSofa = furns.some(f => f.type.includes('sofa'));
      if (!hasSofa) sofaArrangementScore = 0.5;
      // Relationship to dining
      const dining = floor.spaces.find(sp => sp.type === 'dining');
      if (dining) {
        const dx = Math.abs((s.rect.x + s.rect.w / 2) - (dining.rect.x + dining.rect.w / 2));
        const dy = Math.abs((s.rect.y + s.rect.h / 2) - (dining.rect.y + dining.rect.h / 2));
        if (dx + dy > 8) sofaArrangementScore -= 0.2;
      }
    }

    if (s.type === 'dining') {
      const hasTable = furns.some(f => f.type.includes('dining-table'));
      if (!hasTable) tableClearanceScore = 0.5;
      else {
        // Table clearance: need 0.8 around
        const table = furns.find(f => f.type.includes('dining-table'))!;
        if (s.rect.w < table.rect.w + 1.6 || s.rect.h < table.rect.h + 1.6) {
          tableClearanceScore = 0.6;
          issues.push('dining table clearance tight');
        }
      }
    }

    if (s.type === 'kitchen') {
      const hasCounter = furns.some(f => f.type.includes('kitchen-counter'));
      if (!hasCounter) {
        workZoneScore = 0.4;
        counterContinuityScore = 0.4;
        issues.push('no kitchen counter');
      } else {
        // Counter continuity: L-shaped preferred
        const counter = furns.find(f => f.type.includes('kitchen-counter'))!;
        if (counter.type === 'kitchen-counter-l') counterContinuityScore = 1;
        else counterContinuityScore = 0.7;
        // Work zone: should have at least 1m clearance front
        if (counter.clearanceFront && counter.clearanceFront < 0.9) workZoneScore = 0.6;
      }
    }

    let overall = 1;
    if (s.type === 'bedroom' || s.type === 'master-bedroom') {
      overall = (bedPlacementScore * 0.3 + bedAccessScore * 0.2 + wardrobeAccessScore * 0.2 + doorClearanceScore * 0.15 + circulationScore * 0.1 + windowRelationshipScore * 0.05);
    } else if (s.type === 'living') {
      overall = (sofaArrangementScore * 0.4 + circulationScore * 0.3 + doorClearanceScore * 0.2 + windowRelationshipScore * 0.1);
    } else if (s.type === 'dining') {
      overall = (tableClearanceScore * 0.5 + circulationScore * 0.3 + doorClearanceScore * 0.2);
    } else if (s.type === 'kitchen') {
      overall = (workZoneScore * 0.4 + counterContinuityScore * 0.3 + doorClearanceScore * 0.2 + windowRelationshipScore * 0.1);
    } else {
      overall = (doorClearanceScore * 0.5 + circulationScore * 0.3 + windowRelationshipScore * 0.2);
    }

    overall = Math.max(0, Math.min(1, overall));

    if (overall > 0.8) strengths.push(`+ ${s.label} usability good ${(overall * 100).toFixed(0)}%`);
    else if (overall < 0.5) weaknesses.push(`- ${s.label} usability weak ${(overall * 100).toFixed(0)}%: ${issues.slice(0, 2).join(', ')}`);

    rooms.push({
      roomId: s.id,
      roomType: s.type,
      bedPlacementScore: s.type.includes('bedroom') ? bedPlacementScore : undefined,
      bedAccessScore: s.type.includes('bedroom') ? bedAccessScore : undefined,
      wardrobeAccessScore: s.type.includes('bedroom') ? wardrobeAccessScore : undefined,
      doorClearanceScore,
      circulationScore,
      windowRelationshipScore,
      sofaArrangementScore: s.type === 'living' ? sofaArrangementScore : undefined,
      tableClearanceScore: s.type === 'dining' ? tableClearanceScore : undefined,
      workZoneScore: s.type === 'kitchen' ? workZoneScore : undefined,
      counterContinuityScore: s.type === 'kitchen' ? counterContinuityScore : undefined,
      overall,
      issues,
    });
  }

  const avg = rooms.length > 0 ? rooms.reduce((sum, r) => sum + r.overall, 0) / rooms.length : 1;
  const score = Math.max(0, Math.min(1, avg));

  return {
    score,
    rooms: rooms.sort((a, b) => b.overall - a.overall),
    findings,
    strengths: Array.from(new Set(strengths)).slice(0, 6),
    weaknesses: Array.from(new Set(weaknesses)).slice(0, 6),
  };
}
