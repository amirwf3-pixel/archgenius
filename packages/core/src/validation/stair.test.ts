import { describe, it, expect } from 'vitest';
import { solveStair } from '../generator/stair-solver.js';
import { DEFAULT_STAIR_CONFIG } from '../model/stairs.js';
import { validateStairs } from './stair.js';
import type { Floor } from '../model/floor.js';

function mkFloor(stairRect?: { x:number;y:number;w:number;h:number }): Floor {
  let stairs: any[] = [];
  if (stairRect) {
    const sol = solveStair(stairRect, DEFAULT_STAIR_CONFIG, 'south');
    if (sol.ok && sol.stair) stairs = [sol.stair];
  }
  return {
    level: 0, floorHeight: 3.2, elevation: 0,
    footprint: { x: 0, y: 0, w: 20, h: 20 },
    spaces: [
      // A fake corridor that overlaps the stair so stair is 'accessible'
      { id: 'corridor', type: 'corridor', rect: { x: 0, y: 0, w: 20, h: 1.6 }, label: 'Corridor', zone: 'circulation', polygon: [], area: 0, wallIds: [], openingIds: [], adjacentSpaceIds: [], hasExteriorWall: false, daylightRequired: false, targetArea: 0, minArea: 0, floor: 0, privacy: 'service' as const, orientation: 'any' as const },
    ],
    walls: [], openings: [], elevators: [], furniture: [],
    parkingStalls: [], stairs,
  };
}

describe('Stair validator', () => {
  it('accepts a valid U-stair', () => {
    const floor = mkFloor({ x: 0, y: 0, w: 2.6, h: 4.4 });
    // Shift stair so it adjoins corridor at south (corridor is at y=0..1.6).
    floor.stairs[0].footprint = { ...floor.stairs[0].rect };
    const f = validateStairs(floor);
    const hard = f.filter(x => x.severity === 'hard');
    expect(hard).toEqual([]);
  });

  it('flags STAIR_OUTSIDE_BUILDING when stair extends past floor footprint', () => {
    const floor = mkFloor();
    const sol = solveStair({ x: -5, y: -5, w: 2.6, h: 4.4 }, DEFAULT_STAIR_CONFIG, 'south');
    expect(sol.ok).toBe(true);
    floor.stairs = [sol.stair!];
    const f = validateStairs(floor);
    expect(f.some(x => x.code === 'STAIR_OUTSIDE_BUILDING')).toBe(true);
  });

  it('flags STAIR_RISE_MISMATCH on manual tampering', () => {
    const floor = mkFloor({ x: 0, y: 0, w: 2.6, h: 4.4 });
    floor.stairs[0].totalRisers = 99;
    const f = validateStairs(floor);
    expect(f.some(x => x.code === 'STAIR_RISE_MISMATCH')).toBe(true);
  });

  it('flags FURN_ON_STAIR if furniture is placed on a flight', () => {
    const floor = mkFloor({ x: 0, y: 0, w: 2.6, h: 4.4 });
    const fl = floor.stairs[0].flights[0];
    floor.furniture.push({
      id: 'crate', type: 'sofa', spaceId: 'stair-hall',
      rect: { ...fl.footprint }, facing: 0, clearanceRequired: false,
    } as any);
    const f = validateStairs(floor);
    expect(f.some(x => x.code === 'FURN_ON_STAIR')).toBe(true);
  });
});
