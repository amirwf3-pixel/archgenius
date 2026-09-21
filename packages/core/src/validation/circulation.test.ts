/**
 * Phase 15 M5 — circulation QUALITY validation tests (topology, not just connectivity).
 * Synthetic floors isolate each new finding code deterministically.
 */
import { describe, it, expect } from 'vitest';
import { validateCirculation } from './circulation.js';
import type { Floor } from '../model/floor.js';

type S = { id: string; type: string; label: string; x: number; y: number; w: number; h: number };

function makeFloor(level: number, spaces: S[], pairs: Array<[string, string, number?, 'door' | 'entrance' | 'sliding-door'?]>): Floor {
  const walls = pairs.map(([a, b], i) => ({
    id: `w${i}`,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    spaceIds: [a, b === 'ext' ? undefined : b],
    kind: 'interior',
  }));
  const openings = pairs.map(([a, b], i) => ({
    id: `o${i}`,
    type: (b === 'ext' ? 'entrance' : (pairs[i][3] ?? 'door')) as 'door' | 'entrance' | 'sliding-door',
    wallId: `w${i}`,
    center: { x: 0.5, y: 0 },
    width: pairs[i][2] ?? 0.95,
    swing: 'sliding',
    spaceA: a,
    spaceB: b === 'ext' ? undefined : b,
  }));
  return {
    level,
    spaces: spaces.map(s => ({ id: s.id, type: s.type, label: s.label, level, rect: { x: s.x, y: s.y, w: s.w, h: s.h }, wallIds: [], openingIds: [], adjacentSpaceIds: [], area: s.w * s.h, privacy: 'public' })),
    walls,
    openings,
  } as unknown as Floor;
}

const sp = (id: string, type: string, x: number, y = 0): S => ({ id, type, label: type, x, y, w: 3, h: 3 });

describe('Phase 15 M5 — CIRC_ROOM_THROUGH_ROOM', () => {
  it('flags a bedroom used as the only corridor to another room', () => {
    const floor = makeFloor(0,
      [sp('e', 'entrance', 0), sp('c', 'corridor', 3), sp('b1', 'bedroom', 6), sp('ba', 'bathroom', 9), sp('b2', 'bedroom', 12)],
      [['e', 'c'], ['c', 'b1'], ['b1', 'ba'], ['ba', 'b2']]);
    const fs = validateCirculation(floor).filter(x => x.code === 'CIRC_ROOM_THROUGH_ROOM');
    expect(fs.length).toBeGreaterThanOrEqual(2); // b1 and ba both strand rooms
    expect(fs.some(x => x.entityIds?.includes('b1'))).toBe(true);
  });

  it('exempts a pure ensuite bathroom hanging off its own bedroom', () => {
    const floor = makeFloor(0,
      [sp('e', 'entrance', 0), sp('c', 'corridor', 3), sp('mb', 'master-bedroom', 6), sp('mba', 'master-bathroom', 9)],
      [['e', 'c'], ['c', 'mb'], ['mb', 'mba']]);
    expect(validateCirculation(floor).some(x => x.code === 'CIRC_ROOM_THROUGH_ROOM')).toBe(false);
  });
});

describe('Phase 15 M5 — CIRC_INVALID_ENTRY', () => {
  it('street door into a bedroom is hard; into the foyer is clean', () => {
    // External wall: spaceIds = [interior, undefined]; wall 'ext' side marks it as the street door.
    const bad = makeFloor(0, [sp('bd', 'bedroom', 0), sp('c', 'corridor', 3)],
      [['bd', 'ext'], ['bd', 'c']]);
    expect(validateCirculation(bad).some(x => x.code === 'CIRC_INVALID_ENTRY' && x.severity === 'hard')).toBe(true);
    const ok = makeFloor(0, [sp('fo', 'foyer', 0), sp('c', 'corridor', 3), sp('bd', 'bedroom', 6)],
      [['fo', 'ext'], ['c', 'fo'], ['bd', 'c']]);
    expect(validateCirculation(ok).some(x => x.code === 'CIRC_INVALID_ENTRY')).toBe(false);
  });
});

describe('Phase 15 M5 — CIRC_REDUNDANT_DOOR', () => {
  it('two doors between the same room pair are soft-flagged', () => {
    const floor = makeFloor(0, [sp('e', 'entrance', 0), sp('bd', 'bedroom', 3)],
      [['e', 'bd'], ['e', 'bd']]);
    expect(validateCirculation(floor).some(x => x.code === 'CIRC_REDUNDANT_DOOR' && x.severity === 'soft')).toBe(true);
  });
});

describe('Phase 15 M5 — CIRC_EXCESSIVE_PATH', () => {
  it('a 7-hop door chain flags the far rooms but a 3-hop plan stays clean', () => {
    const chain: S[] = [sp('e', 'entrance', 0), sp('c', 'corridor', 3)];
    const pairs: Array<[string, string]> = [['e', 'c']];
    for (let i = 0; i < 6; i++) { chain.push(sp(`r${i}`, 'bedroom', 6 + i * 3)); pairs.push([i === 0 ? 'c' : `r${i - 1}`, `r${i}`]); }
    const many = validateCirculation(makeFloor(0, chain, pairs)).filter(x => x.code === 'CIRC_EXCESSIVE_PATH');
    expect(many.length).toBeGreaterThan(0);
    const short = makeFloor(0, [sp('e', 'entrance', 0), sp('c', 'corridor', 3), sp('bd', 'bedroom', 6)],
      [['e', 'c'], ['c', 'bd']]);
    expect(validateCirculation(short).some(x => x.code === 'CIRC_EXCESSIVE_PATH')).toBe(false);
  });
});

describe('Phase 15 M8 — upper-floor seeds come from the vertical hall', () => {
  it('an upper-floor stair hall that opens into nothing strands the floor (hard)', () => {
    // Hall shares the floor but has NO door to the corridor component — you can
    // climb the stairs and still not enter the floor. Seeding the BFS from every
    // circulation space (pre-M8) hid this; the hall must reach the rooms.
    const floor = makeFloor(1,
      [sp('sh', 'stair-hall', 0), sp('c', 'corridor', 3), sp('bd', 'bedroom', 6)],
      [['c', 'bd']]);
    const fs = validateCirculation(floor).filter(x => x.code === 'CIRC_INACCESSIBLE_SPACE' && x.severity === 'hard');
    expect(fs.length).toBeGreaterThanOrEqual(2); // corridor and bedroom both stranded behind a door-less hall
  });

  it('the same floor is clean once the hall links the corridor', () => {
    const floor = makeFloor(1,
      [sp('sh', 'stair-hall', 0), sp('c', 'corridor', 3), sp('bd', 'bedroom', 6)],
      [['sh', 'c'], ['c', 'bd']]);
    expect(validateCirculation(floor).some(x => x.code === 'CIRC_INACCESSIBLE_SPACE')).toBe(false);
  });
});

describe('Phase 15 M5 — CIRC_VERTICAL_DISCONNECTED', () => {
  it('an upper floor with rooms but no stair hall is hard-flagged', () => {
    const floor = makeFloor(1, [sp('sh', 'stair-hall', 0), sp('bd', 'bedroom', 3)], [['sh', 'bd']]);
    expect(validateCirculation(floor).some(x => x.code === 'CIRC_VERTICAL_DISCONNECTED')).toBe(false);
    const orphanFloor = makeFloor(1, [sp('bd', 'bedroom', 0)], []);
    expect(validateCirculation(orphanFloor).some(x => x.code === 'CIRC_VERTICAL_DISCONNECTED')).toBe(true);
  });
});
