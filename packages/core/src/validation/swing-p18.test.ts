import { describe, it, expect } from 'vitest';
import { validateCirculation } from '../validation/circulation.js';
import { validateArchitecturalQA } from '../validation/architectural-qa.js';
import { placeFurniture } from '../generator/furniture.js';
import { rectBlocksDoorSwing, segmentBlocksDoorSwing, doorSwingSectorPolygon } from '../geometry/swing.js';
import type { Floor } from '../model/floor.js';
import type { Opening } from '../model/opening.js';
import type { Space } from '../model/space.js';
import type { Wall } from '../model/wall.js';
import type { Rect } from '../geometry/rect.js';

/**
 * Phase 18 — final QA fixes for the four remaining systemic SOFT findings.
 *
 * Door-swing + furniture findings were dominated by proxy heuristics: the swing
 * check used the arc's bounding box + 0.4 m proximity (flagging every normal
 * T-junction), and the furniture check used a 0.8 m center-distance proxy. Both
 * now use the exact 90° swing sector the Opening model already carries
 * (geometry/swing.ts). The furniture producer is door-aware and skips pieces
 * that would enter a swing sector. These tests pin:
 *  - genuinely blocked swings are STILL flagged (no suppression)
 *  - tangential/T-junction contacts are clear (precision, not weakening)
 *  - the producer never places furniture into a swing sector
 *  - real plans stay hard-clean and deterministic
 */

/** A 90° left-hinged door: wall along +x at y=0, hinge at (hx, 0), swinging to -y (into the room above). */
function swingDoor(hx: number, width = 0.9): Opening {
  return {
    id: 'd1', type: 'door', wallId: 'w-host',
    center: { x: hx + width / 2, y: 0 },
    wallDir: { x: 1, y: 0 }, normal: { x: 0, y: -1 },
    width, height: 2.1, sill: 0,
    swing: 'left',
    hinge: { x: hx, y: 0 },
    leafEnd: { x: hx + width, y: 0 },
    openEnd: { x: hx, y: -width },
    swingAngle: 90, leafThickness: 0.04, floor: 0,
  } as Opening;
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number, kind: Wall['kind'] = 'interior'): Wall {
  return { id, kind, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.2, spaceIds: [null, null], openingIds: [], floor: 0 };
}

function space(id: string, type: string, rect: Rect): Space {
  return {
    id, type, label: type, level: 0, rect,
    polygon: [
      { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
    ],
    area: rect.w * rect.h, wallIds: [], openingIds: [], adjacentSpaceIds: [], privacy: 'private',
  } as unknown as Space;
}

function floorOf(spaces: Space[], walls: Wall[], openings: Opening[], furniture: any[] = []): Floor {
  return {
    level: 0, floorHeight: 3, elevation: 0,
    footprint: { x: 0, y: -3, w: 6, h: 6 },
    spaces, walls, openings, stairs: [], elevators: [], furniture,
    parkingStalls: [],
  } as unknown as Floor;
}

describe('Phase 18 — exact swing-sector geometry', () => {
  it('sector polygon covers the true quarter disk (contains the 45° mid-arc point)', () => {
    const o = swingDoor(0);
    const poly = doorSwingSectorPolygon(o)!;
    // point on the true arc at 45°, radius r
    const r = 0.9, mx = r * Math.SQRT1_2, my = -r * Math.SQRT1_2;
    // the polygon (hinge + circumscribed arc) must contain it — point-in-polygon via winding: use ray cast
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > my) !== (b.y > my) && mx < ((b.x - a.x) * (my - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    expect(inside).toBe(true);
  });

  it('a wall genuinely crossing the swing sector is flagged; a wall behind the hinge is not', () => {
    const o = swingDoor(0.3);
    // baffle across the room 0.5 m into the swing area — genuinely blocks the leaf
    expect(segmentBlocksDoorSwing(0.2, -0.5, 1.4, -0.5, o)).toBe(true);
    // wall at the same distance but on the +y side (behind the closed leaf) — clear
    expect(segmentBlocksDoorSwing(0.2, 0.5, 1.4, 0.5, o)).toBe(false);
    // T-junction: perpendicular wall at the wall end 0.3 m BEYOND the hinge — clear
    expect(segmentBlocksDoorSwing(0.0, 0.0, 0.0, 2.0, o)).toBe(false);
    // a door opening flat against its host wall line (segment along the boundary) — tangential, clear
    expect(segmentBlocksDoorSwing(-0.2, 0.0, -0.05, 0.0, o)).toBe(false);
  });
});

describe('Phase 18 — swing validator precision', () => {
  it('flags a door whose swing sector a wall truly crosses (suppression guard)', () => {
    const o = swingDoor(0.3);
    const fl = floorOf(
      [space('f', 'foyer', { x: 0, y: 0, w: 3, h: 2 }), space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 })],
      [wall('w-host', 0, 0, 3, 0), wall('w-baffle', 0.2, -0.5, 2.8, -0.5)],
      [o],
    );
    const blocked = validateCirculation(fl).filter(f => f.code === 'OPENING_DOOR_SWING_BLOCKED');
    expect(blocked.length).toBe(1);
  });

  it('a normal T-junction door (perpendicular wall at the wall end) is NOT flagged', () => {
    const o = swingDoor(0.3);
    const fl = floorOf(
      [space('f', 'foyer', { x: 0, y: 0, w: 3, h: 2 }), space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 })],
      [wall('w-host', 0, 0, 3, 0), wall('w-junction', 0.0, 0.0, 0.0, 2.0), wall('w-junction2', 3.0, 0.0, 3.0, 2.0)],
      [o],
    );
    const blocked = validateCirculation(fl).filter(f => f.code === 'OPENING_DOOR_SWING_BLOCKED');
    expect(blocked.length).toBe(0);
  });

  it('sliding doors and doors without leaf geometry are exempt', () => {
    const slide = { ...swingDoor(0.3), swing: 'sliding' } as Opening;
    const bare = { ...swingDoor(0.3), hinge: undefined, leafEnd: undefined, openEnd: undefined } as unknown as Opening;
    const fl = floorOf(
      [space('f', 'foyer', { x: 0, y: 0, w: 3, h: 2 }), space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 })],
      [wall('w-host', 0, 0, 3, 0), wall('w-baffle', 0.2, -0.5, 2.8, -0.5)],
      [slide, bare],
    );
    expect(validateCirculation(fl).filter(f => f.code === 'OPENING_DOOR_SWING_BLOCKED').length).toBe(0);
  });
});

describe('Phase 18 — furniture vs door swing', () => {
  it('validator flags furniture inside the swing sector; clear furniture 0.6 m away is not flagged', () => {
    const o = swingDoor(0.3);
    const blocking = { id: 'f-x', type: 'bed-double', rect: { x: 0.4, y: -0.8, w: 1.4, h: 1.9 }, spaceId: 'r1' };
    const fl1 = floorOf([space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 })], [wall('w-host', 0, 0, 3, 0)], [o], [blocking]);
    expect(validateArchitecturalQA(fl1).some(f => f.code === 'FURNITURE_BLOCKS_DOOR')).toBe(true);
    // near (0.6 m from door center — inside the old 0.8 m proxy) but OUTSIDE the sector
    const clear = { id: 'f-y', type: 'wardrobe', rect: { x: 2.2, y: -2.9, w: 0.6, h: 0.5 }, spaceId: 'r1' };
    const fl2 = floorOf([space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 })], [wall('w-host', 0, 0, 3, 0)], [o], [clear]);
    expect(rectBlocksDoorSwing(clear.rect, o)).toBe(false);
    expect(validateArchitecturalQA(fl2).some(f => f.code === 'FURNITURE_BLOCKS_DOOR')).toBe(false);
  });

  it('producer skips a piece that would sit in the swing sector, places it when the door is absent', () => {
    const room = space('r1', 'bedroom', { x: 0, y: -3, w: 3, h: 3 });
    // sw-corner bed (x≈0.05..1.55, y≈-2.95..-1.05) — outside the sector at y∈[0,-0.9]? sector reaches y=-0.9 at x∈[0.3,1.2];
    // use a door whose sector overlaps the sw-corner bed: hinge at 0.3 → sector box x∈[0.3,1.2] y∈[-0.9,0]. Bed at sw does NOT intersect.
    // Instead place the door low on the EAST wall? Keep it simple: wardrobe at north-wall (y≈-0.55..-0.05) DOES intersect the sector.
    const withDoor = placeFurniture([room], [swingDoor(0.3)]);
    const withoutDoor = placeFurniture([room], []);
    // wardrobe (north-wall) intersects the sector → skipped when the door exists
    expect(withDoor.some(f => f.type === 'wardrobe')).toBe(false);
    expect(withoutDoor.some(f => f.type === 'wardrobe')).toBe(true);
    // no placed piece enters the sector
    for (const f of withDoor) expect(rectBlocksDoorSwing(f.rect, swingDoor(0.3))).toBe(false);
    // deterministic
    expect(JSON.stringify(placeFurniture([room], [swingDoor(0.3)]))).toBe(JSON.stringify(withDoor));
  });
});
