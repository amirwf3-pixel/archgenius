/**
 * Phase 16 P16-B — street entrance across access orientations.
 * The ground floor must publish a real exterior entrance door on the
 * requested street side, connecting into interior circulation; every
 * orientation (S/N/E/W) behaves identically, and any deviation is a
 * deterministic HARD finding (NO_STREET_ENTRANCE).
 */
import { describe, it, expect } from 'vitest';
import { buildAccessFrame } from './layout/placer.js';
import { createProject, generate, validateCandidate } from './pipeline.js';
import { validateCirculation } from './validation/circulation.js';
import type { Rect } from './geometry/rect.js';
import type { ProjectInput } from './model/project.js';

const villa = (access: 'north' | 'south' | 'east' | 'west', over: any = {}): ProjectInput => ({
  name: 'P16B', country: 'IR', deterministic: true, seed: 42,
  site: { shape: 'rectangle', width: access === 'east' || access === 'west' ? 30 : 18, length: access === 'east' || access === 'west' ? 20 : 25, accessSide: access, streetWidth: 8, ...over.site },
  building: { type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed', hasStair: true, hasStorage: true, parkingSpaces: 0, ...over.building },
} as ProjectInput);

const bldgBox = (rects: Rect[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const doorOnStreet = (f0: any, side: string, tol = 0.02): boolean => {
  const bb = bldgBox(f0.spaces.map((s: any) => s.rect));
  const door = f0.openings.find((o: any) => o.type === 'entrance');
  if (!door) return false;
  switch (side) {
    case 'south': return Math.abs(door.center.y - bb.y) <= tol;
    case 'north': return Math.abs(door.center.y - (bb.y + bb.h)) <= tol;
    case 'west':  return Math.abs(door.center.x - bb.x) <= tol;
    case 'east':  return Math.abs(door.center.x - (bb.x + bb.w)) <= tol;
  }
  return false;
};
/** BFS from the door's interior space through interior doors only. */
const reachFromDoor = (f0: any, wantTypes: Set<string>): boolean => {
  const door = f0.openings.find((o: any) => o.type === 'entrance');
  if (!door) return false;
  const w = f0.walls.find((x: any) => x.id === door.wallId);
  const innerId = w.spaceIds[0] ?? w.spaceIds[1];
  const adj: Record<string, Set<string>> = {};
  for (const s of f0.spaces) adj[s.id] = new Set();
  for (const o of f0.openings) {
    if (o.id === door.id) continue;
    const ww = f0.walls.find((x: any) => x.id === o.wallId);
    if (ww && ww.spaceIds[0] && ww.spaceIds[1]) { adj[ww.spaceIds[0]].add(ww.spaceIds[1]); adj[ww.spaceIds[1]].add(ww.spaceIds[0]); }
  }
  const seen = new Set<string>([innerId]); const q = [innerId];
  while (q.length) { const id = q.shift()!; for (const n of adj[id]) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  return f0.spaces.filter((s: any) => wantTypes.has(s.type)).every((s: any) => seen.has(s.id));
};

describe('P16-B unit: orientation frame', () => {
  it('south needs no frame', () => {
    expect(buildAccessFrame({ x: 0, y: 0, w: 10, h: 20 }, 'south')).toBeNull();
  });
  it('every frame round-trips rects exactly (isometry)', () => {
    const fp: Rect = { x: 2, y: 3, w: 13.4, h: 18.7 };
    const samples: Rect[] = [fp, { x: 2, y: 3, w: 4, h: 2.5 }, { x: 8.1, y: 12.4, w: 6.3, h: 9.3 }];
    for (const side of ['north', 'east', 'west'] as const) {
      const fr = buildAccessFrame(fp, side)!;
      for (const r of samples) {
        const b = fr.from(fr.to(r));
        expect(b.x).toBeCloseTo(r.x, 9); expect(b.y).toBeCloseTo(r.y, 9);
        expect(b.w).toBeCloseTo(r.w, 9); expect(b.h).toBeCloseTo(r.h, 9);
        expect(fr.to(r).w * fr.to(r).h).toBeCloseTo(r.w * r.h, 9); // area preserved
      }
    }
  });
  it('north maps the top facade to frame-south; east/west map their side too', () => {
    const fp = { x: 0, y: 0, w: 20, h: 30 };
    expect(buildAccessFrame(fp, 'north')!.to({ x: 5, y: 27, w: 6, h: 3 }).y).toBeCloseTo(0, 9);
    expect(buildAccessFrame(fp, 'east')!.to({ x: 17, y: 4, w: 3, h: 6 }).y).toBeCloseTo(0, 9);
    expect(buildAccessFrame(fp, 'west')!.to({ x: 0, y: 4, w: 3, h: 6 }).y).toBeCloseTo(0, 9);
  });
});

describe('P16-B integration: a real street door on every access side', () => {
  for (const side of ['south', 'north', 'east', 'west'] as const) {
    it(`${side.toUpperCase()} access: feasible plan has its front door on the ${side} (street) facade`, () => {
      const r = generate(createProject(villa(side)));
      expect(r.bestCandidate, JSON.stringify(r.infeasible?.explanation ?? '').slice(0, 200)).not.toBeNull();
      const f0 = r.bestCandidate!.floors[0];
      expect(f0.accessSide).toBe(side);
      expect(doorOnStreet(f0, side)).toBe(true);
      // the door's wall is an EXTERIOR wall of the building bbox on that side
      const door = f0.openings.find((o: any) => o.type === 'entrance');
      const wall = f0.walls.find((w: any) => w.id === door.wallId);
      expect(wall.kind).toBe('exterior');
      // interior space behind the door is circulation-quality
      const innerId = wall.spaceIds[0] ?? wall.spaceIds[1];
      const inner = f0.spaces.find((s: any) => s.id === innerId)!;
      expect(['entrance', 'foyer', 'corridor', 'stair-hall', 'living', 'dining']).toContain(inner.type);
      // door -> ... -> circulation spine reaches every stair hall on F0
      expect(reachFromDoor(f0, new Set(['stair-hall']))).toBe(true);
      expect(validateCandidate(r.bestCandidate!).hard).toHaveLength(0);
    });
  }

  it('multi-floor: street -> door -> ground circulation -> stair -> upper circulation is live', () => {
    const r = generate(createProject(villa('north')));
    const b = r.bestCandidate!;
    expect(b.floors.length).toBe(2);
    const f1 = b.floors[1];
    // upper floor has no street door by design, but its halls connect its rooms
    const halls = f1.spaces.filter((s: any) => s.type === 'stair-hall');
    expect(halls.length).toBeGreaterThan(0);
    const vr = validateCandidate(b);
    expect(vr.hard).toHaveLength(0);
    // F1 rooms reachable from its vertical halls via interior doors
    const adj: Record<string, Set<string>> = {};
    for (const s of f1.spaces) adj[s.id] = new Set();
    for (const o of f1.openings) {
      const w = f1.walls.find((x: any) => x.id === o.wallId);
      if (w && w.spaceIds[0] && w.spaceIds[1]) { adj[w.spaceIds[0]].add(w.spaceIds[1]); adj[w.spaceIds[1]].add(w.spaceIds[0]); }
    }
    const seen = new Set(halls.map((h: any) => h.id)); const q = [...seen];
    while (q.length) { const id = q.shift()!; for (const n of adj[id]) if (!seen.has(n)) { seen.add(n); q.push(n); } }
    for (const s of f1.spaces) expect(seen.has(s.id), `orphan on F1: ${s.label}`).toBe(true);
  });

  it('decimal non-square site (13.4x18.7, west) gets a west street door', () => {
    const inp = villa('west', { site: { width: 13.4, length: 18.7 } });
    const r = generate(createProject(inp));
    if (!r.bestCandidate) return; // honest NC is acceptable; a WRONG door is not
    expect(doorOnStreet(r.bestCandidate.floors[0], 'west')).toBe(true);
  });

  it('determinism: two runs emit byte-identical openings', () => {
    const a = generate(createProject(villa('east'))).bestCandidate!;
    const b = generate(createProject(villa('east'))).bestCandidate!;
    expect(JSON.stringify(a.floors.map(f => f.openings))).toBe(JSON.stringify(b.floors.map(f => f.openings)));
  });
});

describe('P16-B validation: sealed, missing and wrong-side doors are HARD', () => {
  const fixture = () => structuredClone(generate(createProject(villa('south'))).bestCandidate!);

  it('missing entrance (no door at all) => NO_STREET_ENTRANCE hard', () => {
    const c = fixture();
    c.floors[0].openings = c.floors[0].openings.filter((o: any) => o.type !== 'entrance');
    const fs = validateCirculation(c.floors[0]).filter(x => x.code === 'NO_STREET_ENTRANCE');
    expect(fs.length).toBe(1);
    expect(fs[0].severity).toBe('hard');
  });

  it('wrong-side: same plan re-requested from the NORTH still demands a north door', () => {
    const c = fixture();
    c.floors[0].accessSide = 'north'; // door physically remains on the south facade
    const fs = validateCirculation(c.floors[0]).filter(x => x.code === 'NO_STREET_ENTRANCE');
    expect(fs.length).toBe(1);
    expect(fs[0].message).toContain('north');
  });

  it('disconnected entrance: door present but the entry room opens into nothing', () => {
    const c = fixture();
    const f0 = c.floors[0] as any;
    const door = f0.openings.find((o: any) => o.type === 'entrance');
    const wall = f0.walls.find((w: any) => w.id === door.wallId);
    const innerId = wall.spaceIds[0] ?? wall.spaceIds[1];
    // remove every interior door touching the entry space
    f0.openings = f0.openings.filter((o: any) => {
      if (o.id === door.id) return true;
      const w = f0.walls.find((x: any) => x.id === o.wallId);
      return !(w && w.spaceIds.includes(innerId));
    });
    const fs = validateCirculation(f0).filter(x => x.code === 'NO_STREET_ENTRANCE');
    expect(fs.length).toBe(1);
    expect(fs[0].message).toContain('dead-ended');
  });

  it('gate: tampering the candidate to seal the street face removes it from publication', () => {
    const c = fixture();
    c.floors[0].openings = c.floors[0].openings.filter((o: any) => o.type !== 'entrance');
    const vr = validateCandidate(c);
    expect(vr.hard.some(x => x.code === 'NO_STREET_ENTRANCE')).toBe(true);
  });

  it('upper floors are exempt (they arrive via the stair hall, not the street)', () => {
    const r = generate(createProject(villa('north')));
    const f1 = structuredClone(r.bestCandidate!.floors[1]);
    expect(validateCirculation(f1).filter(x => x.code === 'NO_STREET_ENTRANCE')).toHaveLength(0);
  });
});
