/**
 * Task 128 — opt-in `lShapeRoomQualitySelection` (two-stage L-shape wing-plan selection).
 *
 * Stage 1 is the unchanged selection. Only when its winner has no MBH4-ROOM-001 main room
 * (pack area AND width thresholds) are the same eligible plans re-ranked to prefer one whose
 * main room meets them and is no larger than L_ROOM_QUALITY_MAX_AREA. Plans are only
 * selected — never moved or resized; stair / elevator untouched. Omitted / false must be
 * byte-identical.
 */
import { describe, it, expect } from 'vitest';
import { generateLayouts, type GenerateLayoutsOptions } from './generator.js';
import {
  L_ROOM_QUALITY_SELECTED, L_ROOM_QUALITY_MAX_AREA, meetsRoom001Main, roomQualityPreferred, selectWithRoomQuality,
} from './l-shape.js';
import { room001Thresholds } from '../layout/placer.js';
import { writeDXF } from '../dxf/writer.js';
import type { Rect } from '../geometry/index.js';
import type { LayoutCandidate } from '../model/layout.js';
import type { ProjectInput } from '../model/project.js';
import type { Space } from '../model/space.js';

const RECT = { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 } as const;
const RECT14 = { ...RECT, width: 14, length: 22 } as const;
const LSHAPE = { ...RECT, shape: 'l-shape', width: 20, length: 26, lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' } } as const;
const B3LIFT = { type: 'villa', bedrooms: 3, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, hasElevator: true, floors: 3 } as const;
const input = (site: object, building: object, seed: number): ProjectInput =>
  JSON.parse(JSON.stringify({ site, building, seed, deterministic: true, jurisdiction: 'IR' }));

const CUR: GenerateLayoutsOptions = {
  galleryDaylightAware: true, connectStairCore: true, preferDiningKitchenAdjacency: true, preferLShapeProgrammeAdjacency: true,
  programmeDoorCompletion: true, stackPublicForDaylight: true, bridgeThinStairGap: true, connectIsolatedRooms: true,
  diningFacadeRow: true, rotateShallowStairPocket: true, mainRoomMinDimension: true, diningEntryColumn: true,
  upperFloorFrontPrivate: true, bridgeElevatorLandingGap: true, linkLShapeWingCorridors: true, alignLShapeEntryFoyer: true,
  stackedPairMinArea: true, notchShaftCorridorOverlap: true, lShapeUpperCoreCirculation: true,
};
const ON: GenerateLayoutsOptions = { ...CUR, lShapeRoomQualitySelection: true };
const STRATS = ['area-efficiency', 'functional-circulation', 'daylight-orientation', 'alternative-zoning'] as const;
const gen = (inp: ProjectInput, opts: GenerateLayoutsOptions) => generateLayouts(JSON.parse(JSON.stringify(inp)), [...STRATS], opts);
const byStrategy = (cs: LayoutCandidate[], s: string) => cs.find(c => c.metadata.strategy === s)!;
const snap = (x: LayoutCandidate[] | LayoutCandidate) => JSON.stringify((Array.isArray(x) ? x : [x]).map(c => ({ ...c, metadata: { ...c.metadata, generatedAt: 0 } })));
const hard = (c: LayoutCandidate, code?: string) => c.findings.filter(f => f.severity === 'hard' && (code === undefined || f.code === code));
/** circulation / access / daylight findings, every severity */
const CAD = /^CIRC|CIRCULATION|ACCESS|DYL|DAYLIGHT|ELEV_SHAFT_NO_LANDING/;
const cadCounts = (c: LayoutCandidate) => {
  const m: Record<string, number> = {};
  for (const f of c.findings) if (CAD.test(f.code)) { const k = `${f.severity}:${f.code}`; m[k] = (m[k] ?? 0) + 1; }
  return m;
};
const coreRects = (c: LayoutCandidate) => c.floors.map(f => f.spaces
  .filter(s => s.type === 'stair-hall' || s.type === 'elevator-hall' || s.type === 'elevator-shaft')
  .map(s => `${s.type}@${[s.rect.x, s.rect.y, s.rect.w, s.rect.h].map(v => v.toFixed(3)).join(',')}`).sort().join('|'));
const sp = (id: string, type: string, rect: Rect): Space => ({ id, type, rect } as unknown as Space);
const TH = room001Thresholds(true)!;

describe('Task 128 — pure two-stage helpers (pack thresholds, ≤ 60 m² quality guard)', () => {
  it('uses the pack ROOM-001 thresholds and the shared 60 m² quality guard', () => {
    expect(TH).toEqual({ area: 12, width: 2.7 });
    expect(L_ROOM_QUALITY_MAX_AREA).toBe(60);
  });

  it('preferred room: meets area + width, main type, ≤ 60 m²', () => {
    expect(roomQualityPreferred(sp('b', 'bedroom', { x: 0, y: 0, w: 4, h: 5.13 }), TH)).toBe(true);
    expect(roomQualityPreferred(sp('b', 'bedroom', { x: 0, y: 0, w: 2.5, h: 5.13 }), TH)).toBe(false); // too narrow
    expect(roomQualityPreferred(sp('b', 'bedroom', { x: 0, y: 0, w: 2.7, h: 4.0 }), TH)).toBe(false); // 10.8 m²
    expect(roomQualityPreferred(sp('k', 'kitchen', { x: 0, y: 0, w: 4, h: 5 }), TH)).toBe(false); // not a ROOM-001 main type
    expect(roomQualityPreferred(sp('b', 'bedroom', { x: 0, y: 0, w: 6, h: 10 }), TH)).toBe(true); // exactly 60 m²
  });

  it('oversized-room rejection: a room > 60 m² meets ROOM-001 but is never a preferred room', () => {
    const big = sp('b', 'bedroom', { x: 2, y: 5.7, w: 12, h: 17.3 }); // 207.6 m²
    expect(meetsRoom001Main(big, TH)).toBe(true);
    expect(roomQualityPreferred(big, TH)).toBe(false);
    expect(roomQualityPreferred(sp('b', 'bedroom', { x: 0, y: 0, w: 6, h: 10.1 }), TH)).toBe(false); // 60.6 m²
  });

  // a fake ranking: stage 1 returns plans[0]; the key (when given) prefers the first plan it accepts.
  const narrow = { spaces: [sp('n', 'bedroom', { x: 0, y: 0, w: 2.5, h: 5.13 })] };
  const good = { spaces: [sp('g', 'bedroom', { x: 0, y: 0, w: 4, h: 5.13 })] };
  const oversized = { spaces: [sp('o', 'bedroom', { x: 0, y: 0, w: 12, h: 17.3 })] };
  const ranking = (plans: { spaces: Space[] }[]) => {
    const calls: boolean[] = [];
    const select = (key: ((p: { spaces: Space[] }) => boolean) | null) => {
      calls.push(key !== null);
      return (key && plans.find(key)) || plans[0];
    };
    return { select, calls };
  };

  it('stage 2 re-ranks only when the stage-1 winner fails ROOM-001, and picks the ≤ 60 m² room plan', () => {
    const r = ranking([narrow, oversized, good]);
    const res = selectWithRoomQuality(r.select(null), r.select, TH);
    expect(res).toEqual({ best: good, reranked: true });
    expect(r.calls).toEqual([false, true]);
  });

  it('winner already passing ROOM-001 (even via an oversized room) → no re-ranking', () => {
    for (const w of [good, oversized]) {
      const r = ranking([w, narrow, good]);
      const res = selectWithRoomQuality(r.select(null), r.select, TH);
      expect(res).toEqual({ best: w, reranked: false });
      expect(r.calls).toEqual([false]);
    }
  });

  it('only oversized alternatives → existing ranking preserved', () => {
    const r = ranking([narrow, oversized]);
    expect(selectWithRoomQuality(r.select(null), r.select, TH)).toEqual({ best: narrow, reranked: false });
  });
});

describe('Task 128 — Group A: lshape/b3lift L2 (six cases)', () => {
  const EXPECT_HARD: Record<string, [number, number]> = {
    'alternative-zoning': [4, 3], 'functional-circulation': [4, 0], 'area-efficiency': [6, 5],
  };
  for (const seed of [42, 7]) {
    const base = gen(input(LSHAPE, B3LIFT, seed), CUR);
    const on = gen(input(LSHAPE, B3LIFT, seed), ON);
    for (const strategy of Object.keys(EXPECT_HARD)) {
      it(`seed ${seed} ${strategy}: ROOM-001 HARD 1 → 0 by selection only`, () => {
        const b = byStrategy(base, strategy), c = byStrategy(on, strategy);
        expect(hard(b, 'MBH4-ROOM-001').length).toBe(1);
        expect(hard(c, 'MBH4-ROOM-001').length).toBe(0);
        expect([hard(b).length, hard(c).length]).toEqual(EXPECT_HARD[strategy]);
        if (strategy === 'functional-circulation') expect([b.valid, c.valid]).toEqual([false, true]);
        expect(c.explanations.some(e => e.startsWith(L_ROOM_QUALITY_SELECTED))).toBe(true);
        // ground floor, L1 and stair / elevator geometry untouched
        expect(JSON.stringify(c.floors[0].spaces)).toBe(JSON.stringify(b.floors[0].spaces));
        expect(JSON.stringify(c.floors[1].spaces)).toBe(JSON.stringify(b.floors[1].spaces));
        expect(coreRects(c)).toEqual(coreRects(b));
        // L2 main room: the planner's own 4.0 m-wide plan cell, stacked on the L1 bedroom, ≤ 60 m²
        const bed2 = c.floors[2].spaces.find(s => s.type === 'bedroom')!;
        const bed1 = c.floors[1].spaces.find(s => s.type === 'bedroom')!;
        expect(bed2.rect).toEqual(bed1.rect);
        expect(Math.min(bed2.rect.w, bed2.rect.h)).toBeGreaterThanOrEqual(TH.width);
        expect(bed2.rect.w * bed2.rect.h).toBeGreaterThanOrEqual(TH.area);
        // no new room > 60 m² anywhere
        const big = (x: LayoutCandidate) => x.floors.flatMap(f => f.spaces)
          .filter(s => s.type !== 'corridor' && s.rect.w * s.rect.h > L_ROOM_QUALITY_MAX_AREA)
          .map(s => `${s.type}@${JSON.stringify(s.rect)}`).sort();
        expect(big(c).every(k => big(b).includes(k))).toBe(true);
        // circulation / access / daylight findings never grow, at any severity
        const cb = cadCounts(b), cc = cadCounts(c);
        for (const k of Object.keys(cc)) expect(cc[k]).toBeLessThanOrEqual(cb[k] ?? 0);
      });
    }
    it(`seed ${seed} daylight-orientation: winner already passes ROOM-001 → no re-ranking, identical`, () => {
      const b = byStrategy(base, 'daylight-orientation'), c = byStrategy(on, 'daylight-orientation');
      expect(hard(b, 'MBH4-ROOM-001').length).toBe(0);
      expect(c.explanations.some(e => e.startsWith(L_ROOM_QUALITY_SELECTED))).toBe(false);
      expect(snap(c)).toBe(snap(b));
    });
  }

  it('deterministic across repeated runs', () => {
    expect(snap(gen(input(LSHAPE, B3LIFT, 42), ON))).toBe(snap(gen(input(LSHAPE, B3LIFT, 42), ON)));
  });

  it('DXF of a re-ranked candidate stays R12 ASCII with only $ACADVER = AC1009', () => {
    const c = byStrategy(gen(input(LSHAPE, B3LIFT, 42), ON), 'functional-circulation');
    const dxf = writeDXF(c, 'QA');
    const hdr = dxf.slice(0, dxf.indexOf('ENDSEC'));
    expect([...hdr.matchAll(/\n\s*9\r?\n(\$\w+)/g)].map(m => m[1])).toEqual(['$ACADVER']);
    expect(/\$ACADVER\r?\n\s*1\r?\nAC1009/.test(hdr)).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(dxf)).toBe(true);
  });
});

describe('Task 128 — Group B and option-off identity', () => {
  for (const seed of [42, 7]) {
    it(`rect14/b3lift seed ${seed}: unchanged (Group B keeps its ROOM-001 HARD)`, () => {
      const b = gen(input(RECT14, B3LIFT, seed), CUR), c = gen(input(RECT14, B3LIFT, seed), ON);
      expect(snap(c)).toBe(snap(b));
      expect(hard(byStrategy(c, 'alternative-zoning'), 'MBH4-ROOM-001').length).toBe(1);
    });
  }

  it('option omitted / false is byte-identical', () => {
    for (const inp of [input(LSHAPE, B3LIFT, 42), input(LSHAPE, B3LIFT, 7)]) {
      const omitted = gen(inp, CUR);
      expect(snap(gen(inp, { ...CUR, lShapeRoomQualitySelection: false }))).toBe(snap(omitted));
      expect(omitted.some(c => c.explanations.some(e => e.startsWith(L_ROOM_QUALITY_SELECTED)))).toBe(false);
    }
  });
});
