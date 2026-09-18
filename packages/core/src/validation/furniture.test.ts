import { describe, it, expect } from 'vitest';
import { validateFurniture } from './furniture.js';
import type { Floor } from '../model/floor.js';

function mkSpace(id: string, x: number, y: number, w: number, h: number) {
  return {
    id, type: 'bedroom', label: id, zone: 'private',
    rect: { x, y, w, h }, polygon: [
      { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
    ], area: w * h,
    adjacentSpaceIds: [], openings: [], hasExteriorWall: false,
    daylightRequired: true, targetArea: w * h,
    minWidth: 2.5, minLength: 3.0,
    privacy: 'private' as const, naturalLight: true, ventilation: true,
  } as any;
}

function mkFurn(id: string, spaceId: string, x: number, y: number, w: number, h: number) {
  return { id, type: 'bed', spaceId, rect: { x, y, w, h }, facing: 0, clearanceRequired: false } as any;
}

describe('Furniture validation', () => {
  it('flags furniture outside its room', () => {
    const floor: Floor = {
      level: 0, footprint: { x: 0, y: 0, w: 10, h: 10 },
      buildableArea: { x: 0, y: 0, w: 10, h: 10 },
      spaces: [mkSpace('br1', 0, 0, 4, 4)],
      walls: [], openings: [], stairs: [], parkingStalls: [], furniture: [
        mkFurn('bed1', 'br1', 3, 3, 2, 2), // extends outside br1 (to x=5,y=5)
      ],
    };
    const f = validateFurniture(floor);
    expect(f.some(x => x.code === 'FURN_OUTSIDE_ROOM')).toBe(true);
  });

  it('flags furniture collisions inside the same room', () => {
    const floor: Floor = {
      level: 0, footprint: { x: 0, y: 0, w: 10, h: 10 },
      buildableArea: { x: 0, y: 0, w: 10, h: 10 },
      spaces: [mkSpace('br1', 0, 0, 6, 6)],
      walls: [], openings: [], stairs: [], parkingStalls: [], furniture: [
        mkFurn('a', 'br1', 0, 0, 2, 2),
        mkFurn('b', 'br1', 1, 1, 2, 2),
      ],
    };
    const f = validateFurniture(floor);
    expect(f.some(x => x.code === 'FURN_COLLISION')).toBe(true);
  });

  it('accepts non-overlapping in-room furniture', () => {
    const floor: Floor = {
      level: 0, footprint: { x: 0, y: 0, w: 10, h: 10 },
      buildableArea: { x: 0, y: 0, w: 10, h: 10 },
      spaces: [mkSpace('br1', 0, 0, 6, 6)],
      walls: [], openings: [], stairs: [], parkingStalls: [], furniture: [
        mkFurn('bed', 'br1', 0, 0, 1.8, 2.0),
        mkFurn('desk', 'br1', 3, 0, 1.2, 0.6),
      ],
    };
    expect(validateFurniture(floor)).toEqual([]);
  });
});
