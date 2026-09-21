/**
 * Door & window placement.
 *
 * V1 heuristic (deterministic):
 *   - One ENTRANCE door on the exterior wall facing the access side,
 *     opening into the entrance/foyer space.
 *   - Each non-circulation room gets ONE interior door connecting it to
 *     an adjacent circulation space (corridor/foyer/stair-hall) or, for
 *     bathrooms, to the directly adjacent bedroom.
 *   - Windows are placed on exterior walls of daylight-required rooms;
 *     width roughly proportional to wall length minus door offsets.
 *
 * Doors sit along the wall at a given offset from one end; the wall's
 * opening list records them so DXF export can "punch" the wall segments.
 */
import type { Floor } from '../model/floor.js';
import type { Wall } from '../model/wall.js';
import type { Opening } from '../model/opening.js';
import type { Space } from '../model/space.js';
import type { AccessSide } from '../model/site.js';
import {
  DOOR_EXT_WIDTH, DOOR_EXT_HEIGHT, DOOR_INT_WIDTH, DOOR_INT_HEIGHT,
  DOOR_BATH_WIDTH, WINDOW_SILL, WINDOW_LINTEL, WINDOW_MIN_WIDTH, EPS,
} from '../units.js';
import { vSub, vNorm } from '../geometry/vec2.js';
import type { Vec2 } from '../geometry/vec2.js';

interface OpeningPlaced {
  wallId: string;
  offset: number; // from start along wall
  width: number;
}

/** Returns the side (N/S/E/W) of the site exterior that a wall lies on, or null. */
function wallSide(wall: Wall, footprint: { x: number; y: number; w: number; h: number }): AccessSide | null {
  const x = wall.start.x, y = wall.start.y;
  const endX = wall.end.x, endY = wall.end.y;
  const mx = (x + endX) / 2, my = (y + endY) / 2;
  if (wall.kind !== 'exterior') return null;
  if (Math.abs(y - footprint.y) < EPS && Math.abs(endY - footprint.y) < EPS && Math.abs(my - footprint.y) < EPS) return 'south';
  if (Math.abs(y - (footprint.y + footprint.h)) < EPS && Math.abs(endY - (footprint.y + footprint.h)) < EPS) return 'north';
  if (Math.abs(x - footprint.x) < EPS && Math.abs(endX - footprint.x) < EPS) return 'west';
  if (Math.abs(x - (footprint.x + footprint.w)) < EPS && Math.abs(endX - (footprint.x + footprint.w)) < EPS) return 'east';
  return null;
}

function wallLength(w: Wall): number {
  return Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
}

function pointAtOffset(w: Wall, offset: number): Vec2 {
  const d = vSub(w.end, w.start);
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: w.start.x + (d.x / l) * offset, y: w.start.y + (d.y / l) * offset };
}

function wallDirection(w: Wall): Vec2 {
  return vNorm(vSub(w.end, w.start));
}

/** Return the normal pointing from wall toward the side where `spaceId` is NOT.
 * For doors of a space, the normal points INTO the space. */
function normalIntoSpace(wall: Wall, spaceId: string): Vec2 {
  const d = wallDirection(wall);
  // left normal = (-dy, dx), right = (dy, -dx)
  const left: Vec2 = { x: -d.y, y: d.x };
  const right: Vec2 = { x: d.y, y: -d.x };
  if (wall.spaceIds[0] === spaceId) return left;
  return right;
}

/** Compute hinge/leaf geometry for a door. */
function computeDoorLeaf(center: Vec2, wallDir: Vec2, normal: Vec2, width: number, swing: 'left' | 'right'): { hinge: Vec2; leafEnd: Vec2; openEnd: Vec2 } {
  const hingeSign = swing === 'right' ? 1 : -1;
  const hinge: Vec2 = {
    x: center.x + wallDir.x * (width / 2) * hingeSign,
    y: center.y + wallDir.y * (width / 2) * hingeSign,
  };
  const leafEnd: Vec2 = {
    x: center.x - wallDir.x * (width / 2) * hingeSign,
    y: center.y - wallDir.y * (width / 2) * hingeSign,
  };
  const openEnd: Vec2 = {
    x: hinge.x + normal.x * width,
    y: hinge.y + normal.y * width,
  };
  return { hinge, leafEnd, openEnd };
}

/** Place openings on a floor, mutating walls/openings arrays. */
export function placeOpenings(floor: Floor, accessSide: AccessSide): { openings: Opening[]; entranceWallId?: string; entranceDoorId?: string } {
  const openings: Opening[] = [];
  let openingCounter = 0;
  const mkId = (type: string) => `${type}-${floor.level}-${openingCounter++}`;
  const occupied = new Map<string, Array<{ from: number; to: number }>>();
  function addOcc(wallId: string, from: number, to: number) {
    let arr = occupied.get(wallId);
    if (!arr) { arr = []; occupied.set(wallId, arr); }
    arr.push({ from: Math.max(0, from), to });
  }
  function findFreeSpan(wall: Wall, width: number, preferEnd: 'start' | 'end' | 'middle' = 'middle', margin = 0.3): { offset: number; width: number } | null {
    const L = wallLength(wall);
    if (L < width + margin * 2) return null;
    const arr = (occupied.get(wall.id) ?? []).slice().sort((a, b) => a.from - b.from);
    const freeSpans: Array<{ from: number; to: number }> = [];
    let cursor = margin;
    for (const occ of arr) {
      if (occ.from > cursor + EPS) freeSpans.push({ from: cursor, to: Math.min(occ.from - margin, L - margin) });
      cursor = Math.max(cursor, occ.to + margin);
    }
    if (cursor < L - margin) freeSpans.push({ from: cursor, to: L - margin });
    const candidates = freeSpans.filter(s => s.to - s.from >= width);
    if (!candidates.length) return null;
    let chosen = candidates[0];
    if (preferEnd === 'end') chosen = candidates[candidates.length - 1];
    else if (preferEnd === 'middle') {
      chosen = candidates.reduce((best, s) => {
        const bestMid = (best.from + best.to) / 2;
        const sMid = (s.from + s.to) / 2;
        const center = L / 2;
        return Math.abs(sMid - center) < Math.abs(bestMid - center) ? s : best;
      }, candidates[0]);
    }
    const offset = preferEnd === 'start'
      ? chosen.from
      : preferEnd === 'end'
        ? chosen.to - width
        : ((chosen.from + chosen.to) / 2) - width / 2;
    return { offset: Math.max(0, Math.min(L - width, offset)), width };
  }

  // ---- Entrance door (ground floor only) ----
  let entranceWallId: string | undefined;
  let entranceDoorId: string | undefined;
  if (floor.level === 0) {
    const circTypes = new Set(['entrance', 'foyer', 'corridor', 'stair-hall']);
    // Prefer an exterior wall on the access side where the interior space
    // is an entrance/foyer/corridor circulation space.
    const candidates = floor.walls
      .filter(w => w.kind === 'exterior' && wallSide(w, floor.footprint) === accessSide)
      .map(w => {
        const insideId = w.spaceIds[0] ?? w.spaceIds[1];
        const inside = insideId ? floor.spaces.find(s => s.id === insideId) : undefined;
        // Rank the interior side of the street door by ENTRY QUALITY, then length:
        // a proper entrance hall beats a foyer, foyer beats the back corridor, corridor
        // beats a stair hall — and none of them tolerate a private/wet landing.
        const entryRank = (tt?: string): number =>
          tt === 'entrance' ? 40000 : tt === 'foyer' ? 30000 : tt === 'corridor' ? 20000 :
          tt === 'stair-hall' ? 10000 : (tt && circTypes.has(tt)) ? 5000 : 0;
        const score = entryRank(inside?.type) + wallLength(w);
        return { w, inside, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const { w: wall, inside } of candidates) {
      const span = findFreeSpan(wall, DOOR_EXT_WIDTH, 'middle', 0.1);
      if (!span) continue;
      const id = mkId('entrance');
      entranceWallId = wall.id;
      entranceDoorId = id;
      const into: string | null = inside ? inside.id : (wall.spaceIds[0] ?? wall.spaceIds[1]);
      const normal = into ? normalIntoSpace(wall, into) : { x: 0, y: 1 };
      const center = pointAtOffset(wall, span.offset + span.width / 2);
      const wallDir = wallDirection(wall);
      const swing: 'left' | 'right' = 'left';
      const leaf = computeDoorLeaf(center, wallDir, normal, DOOR_EXT_WIDTH, swing);
      const op: Opening = {
        id, type: 'entrance', wallId: wall.id, center,
        wallDir, normal,
        width: DOOR_EXT_WIDTH, height: DOOR_EXT_HEIGHT, sill: 0,
        swing, hinge: leaf.hinge, leafEnd: leaf.leafEnd, openEnd: leaf.openEnd, swingAngle: 90, leafThickness: 0.04,
        floor: floor.level,
        spaceA: wall.spaceIds[0] ?? undefined, spaceB: wall.spaceIds[1] ?? undefined,
      };
      openings.push(op);
      addOcc(wall.id, span.offset, span.offset + span.width);
      wall.openingIds.push(id);
      break;
    }
  }

  // ---- Interior doors ----
  // Strategy for V1: place a door on every interior wall where at least one
  // side is a circulation space (corridor/foyer/entrance/stair-hall), and on
  // walls between two circulation spaces. This guarantees full connectivity
  // from the entrance through foyer/corridor to every room.
  // Ensuite bathroom-to-bedroom doors are handled additionally when a bathroom
  // shares an interior wall with a master/regular bedroom and no circulation
  // wall exists (otherwise bathroom opens to corridor which is acceptable).
  const circTypes = new Set(['corridor', 'foyer', 'entrance', 'stair-hall', 'elevator-hall']);
  const spacesById = new Map(floor.spaces.map(s => [s.id, s]));
  function getOther(w: Wall, selfId: string): Space | undefined {
    const oid = w.spaceIds[0] === selfId ? w.spaceIds[1] : w.spaceIds[0];
    return oid ? spacesById.get(oid) : undefined;
  }
  function placeDoorOnWall(wall: Wall, intoSpaceId: string, width: number, prefer: 'start' | 'end' | 'middle' = 'middle') {
    const L = wallLength(wall);
    const margin = L < width + 0.45 ? Math.max(0.02, (L - width) / 2 - 0.01) : 0.2;
    const span = findFreeSpan(wall, width, prefer, margin);
    if (!span) return;
    const id = mkId('door');
    const center = pointAtOffset(wall, span.offset + span.width / 2);
    const wallDir = wallDirection(wall);
    const normal = normalIntoSpace(wall, intoSpaceId);
    // Alternate swing based on wall orientation for variety but deterministic: use hash of wall id
    const swing: 'left' | 'right' = wall.id.charCodeAt(wall.id.length - 1) % 2 === 0 ? 'left' : 'right';
    const leaf = computeDoorLeaf(center, wallDir, normal, width, swing);
    const op: Opening = {
      id, type: 'door', wallId: wall.id, center,
      wallDir, normal,
      width, height: DOOR_INT_HEIGHT, sill: 0,
      swing, hinge: leaf.hinge, leafEnd: leaf.leafEnd, openEnd: leaf.openEnd, swingAngle: 90, leafThickness: 0.04,
      floor: floor.level,
      spaceA: wall.spaceIds[0] ?? undefined, spaceB: wall.spaceIds[1] ?? undefined,
    };
    openings.push(op);
    addOcc(wall.id, span.offset, span.offset + span.width);
    wall.openingIds.push(id);
  }

  // Span check against a specific wall including current occupancy (M5 solver helpers).
  function findFreeSpanOn(wall: Wall, width: number, preferred: { offset: number; width: number }): { offset: number; width: number } | null {
    const L = wallLength(wall);
    const margin = L < width + 0.45 ? Math.max(0.02, (L - width) / 2 - 0.01) : 0.2;
    const span = findFreeSpan(wall, width, 'middle', margin);
    return span ?? null;
  }
  function placeDoorOnWallSelected(wall: Wall, intoSpaceId: string, width: number, span: { offset: number; width: number }) {
    const id = mkId('door');
    const center = pointAtOffset(wall, span.offset + span.width / 2);
    const wallDir = wallDirection(wall);
    const normal = normalIntoSpace(wall, intoSpaceId);
    const swing: 'left' | 'right' = wall.id.charCodeAt(wall.id.length - 1) % 2 === 0 ? 'left' : 'right';
    const leaf = computeDoorLeaf(center, wallDir, normal, width, swing);
    const op: Opening = {
      id, type: 'door', wallId: wall.id, center,
      wallDir, normal,
      width, height: DOOR_INT_HEIGHT, sill: 0,
      swing, hinge: leaf.hinge, leafEnd: leaf.leafEnd, openEnd: leaf.openEnd, swingAngle: 90, leafThickness: 0.04,
      floor: floor.level,
      spaceA: wall.spaceIds[0] ?? undefined, spaceB: wall.spaceIds[1] ?? undefined,
    };
    openings.push(op);
    addOcc(wall.id, span.offset, span.offset + span.width);
    wall.openingIds.push(id);
  }

  // ---- Phase 15 M5: intentional circulation topology (replaces the pre-M5
  // "door on every circulation-adjacent wall" rule plus six ad-hoc patch loops) ----
  // Model: entrance -> foyer/hall -> primary circulation spine (corridor / stair-hall)
  //          -> branching single primary access per room; public / service / private all
  // attach to the spine directly. A room never reaches the spine THROUGH another room
  // unless the topology genuinely cannot host a spine-adjacent wall for it, in which case
  // an INTENTIONAL suite/service link is created (ensuite bath, service store) and nothing
  // else. Redundant shortcuts (bedroom<->bedroom, dining<->kitchen when both already
  // attach to the spine) are not doors the plan needs, so they are not generated.
  const interiorWalls = floor.walls.filter(w => w.kind !== 'exterior' && w.spaceIds[0] && w.spaceIds[1]);
  const WET = new Set(['bathroom', 'master-bathroom', 'guest-wc']);
  const SUITE_HOST = new Set(['master-bedroom', 'bedroom']);
  const SERVICE_STORE = new Set(['storage', 'utility']);

  // Shared-wall segments between a pair of spaces. Walls are already merged
  // per-overlap segment by generateWalls; a pair may share several collinear
  // segments (split by intermediate neighbors) — they are treated as one
  // logical adjacency and the longest usable segment carries the door.
  const pairWalls = new Map<string, Wall[]>();
  for (const w of interiorWalls) {
    const a = w.spaceIds[0]!, b = w.spaceIds[1]!;
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let arr = pairWalls.get(key);
    if (!arr) { arr = []; pairWalls.set(key, arr); }
    arr.push(w);
  }
  function bestFreeWall(walls: Wall[], width: number): { wall: Wall; span: { offset: number; width: number } } | null {
    let best: { wall: Wall; span: { offset: number; width: number } } | null = null;
    for (const w of walls) {
      // Same adaptive margin as placeDoorOnWall so short shared segments
      // (e.g. a slim foyer-corridor link) still qualify for a door.
      const L = wallLength(w);
      const margin = L < width + 0.45 ? Math.max(0.02, (L - width) / 2 - 0.01) : 0.2;
      const span = findFreeSpan(w, width, 'middle', margin);
      if (!span) continue;
      if (!best || L > wallLength(best.wall) || (Math.abs(L - wallLength(best.wall)) < 1e-9 && w.id < best.wall.id)) best = { wall: w, span };
    }
    return best;
  }

  // Score how intentional a door between `room` and `other` is as PRIMARY access.
  // Higher = better. Type-driven only — no geometry-specific constants.
  function primaryAccessScore(roomType: string, otherType: string): number {
    const circ = (t2: string) => otherType === t2 ? 1 : 0;
    switch (roomType) {
      case 'guest-wc':        return circ('foyer') * 96 + circ('entrance') * 94 + circ('corridor') * 90 + circ('stair-hall') * 60 + circ('elevator-hall') * 58;
      case 'bathroom':        return circ('corridor') * 100 + circ('stair-hall') * 70 + circ('elevator-hall') * 68 + circ('foyer') * 60;
      case 'master-bathroom': return circ('corridor') * 90 + circ('stair-hall') * 70 + circ('foyer') * 60 + (otherType === 'master-bedroom' ? 82 : 0);
      case 'bedroom':         return circ('corridor') * 100 + circ('stair-hall') * 75 + circ('elevator-hall') * 73 + circ('foyer') * 50;
      case 'master-bedroom':  return circ('corridor') * 100 + circ('stair-hall') * 75 + circ('foyer') * 45;
      case 'living':          return circ('foyer') * 96 + circ('corridor') * 92 + circ('entrance') * 88 + circ('stair-hall') * 55;
      case 'dining':          return circ('corridor') * 94 + circ('foyer') * 90 + circ('entrance') * 70 + circ('stair-hall') * 55;
      case 'kitchen':         return circ('corridor') * 92 + circ('foyer') * 88 + circ('entrance') * 60;
      case 'family-room': case 'guest-room': return circ('corridor') * 100 + circ('foyer') * 55;
      case 'storage': case 'utility': return circ('kitchen') * 82 + circ('corridor') * 70 + circ('foyer') * 40;
      default:                return circ('corridor') * 100 + circ('foyer') * 90 + circ('entrance') * 80;
    }
  }

  // 1) Spine links between circulation spaces (entrance -> foyer -> corridor ->
  //    stair/elevator halls): exactly one door per adjacent circulation pair,
  //    on the longest shared segment. These form the connected core the rooms
  //    branch from; they are never duplicated.
  const doorWidthFor = (typeA: string, typeB: string): number =>
    (WET.has(typeA) || WET.has(typeB)) ? DOOR_BATH_WIDTH : DOOR_INT_WIDTH;
  const circLinked = new Set<string>();
  for (const [key, walls] of [...pairWalls.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [ida, idb] = key.split('|');
    const a = spacesById.get(ida)!, b = spacesById.get(idb)!;
    const aCirc = circTypes.has(a.type), bCirc = circTypes.has(b.type);
    if (!aCirc || !bCirc) continue;
    // entrance<->corridor only when the floor has no foyer between them
    if ((a.type === 'entrance' && bCirc && b.type === 'corridor' && floor.spaces.some(s => s.type === 'foyer')) ||
        (b.type === 'entrance' && a.type === 'corridor' && floor.spaces.some(s => s.type === 'foyer'))) continue;
    const width = DOOR_INT_WIDTH;
    const pick = bestFreeWall(walls, width);
    if (!pick) continue;
    // door opens INTO the non-entry side (toward rooms) for entries; otherwise into b
    const into = a.type === 'entrance' ? b.id : b.type === 'entrance' ? a.id : b.id;
    placeDoorOnWall(pick.wall, into, width);
    circLinked.add(key);
  }

  // 2) One primary access door per required room, chosen by the score above.
  const needsDoor = (t2: string): boolean =>
    !circTypes.has(t2) && t2 !== 'parking' && t2 !== 'yard' && t2 !== 'balcony';
  const roomByPrimary = new Map<string, { key: string; score: number; wall: Wall; span: { offset: number; width: number }; otherId: string }>();
  for (const s of floor.spaces) {
    if (!needsDoor(s.type)) continue;
    let best: { key: string; score: number; wall: Wall; span: { offset: number; width: number }; otherId: string } | null = null;
    for (const [key, walls] of pairWalls) {
      if (!key.includes(s.id)) continue;
      const [ida, idb] = key.split('|');
      const other = spacesById.get(ida === s.id ? idb : ida)!;
      if (!other || other.type === 'parking' || other.type === 'yard' || other.type === 'balcony') continue;
      // primary access must attach to a circulation space (suite links come later)
      if (!circTypes.has(other.type) && !(s.type === 'master-bathroom' && other.type === 'master-bedroom') && !(SERVICE_STORE.has(s.type) && other.type === 'kitchen')) continue;
      const score = primaryAccessScore(s.type, other.type);
      if (score <= 0) continue;
      const width = doorWidthFor(s.type, other.type);
      const pick = bestFreeWall(walls, width);
      if (!pick) continue;
      // prefer stronger score; tie-break by LONGER usable segment (more comfortable
      // door wall), then by adjacency key for determinism
      const spanScore = pick.span.width;
      if (!best || score > best.score || (score === best.score && (spanScore > best.span.width || (spanScore === best.span.width && key < best.key)))) {
        best = { key, score, wall: pick.wall, span: pick.span, otherId: other.id };
      }
    }
    if (best) roomByPrimary.set(s.id, best);
  }
  for (const [roomId, sel] of [...roomByPrimary.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const width = doorWidthFor(spacesById.get(roomId)!.type, spacesById.get(sel.otherId)!.type);
    const span = findFreeSpanOn(sel.wall, width, sel.span);
    if (!span) continue;
    placeDoorOnWallSelected(sel.wall, roomId, width, span);
  }

  // 2b) Hall-connectivity guarantee: the circulation nodes — entrance / foyer /
  //     corridor / halls, plus living and dining which may act as INTENTIONAL hall
  //     links — must form ONE connected door graph, so every room's primary reaches
  //     the street entry. If geometry separates the foyer from the spine (e.g. a WC
  //     wedged between them), bridge the components with one deliberate link door:
  //     circulation<->circulation first, then circulation<->public, then public<->public.
  //     Private/wet rooms are never used as bridges — that is exactly the through-room
  //     defect this stage eliminates.
  {
    const isLink = (t2: string): boolean => circTypes.has(t2) || t2 === 'living' || t2 === 'dining';
    const linkIds = new Set(floor.spaces.filter(s => isLink(s.type)).map(s => s.id));
    if (linkIds.size > 1) {
      const parent = new Map<string, string>();
      for (const id of linkIds) parent.set(id, id);
      const find = (id: string): string => { let r = id; while (parent.get(r) !== r) r = parent.get(r)!; let c = id; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
      const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
      for (const o of openings) {
        if (o.type === 'window') continue;
        if (o.spaceA && o.spaceB && linkIds.has(o.spaceA) && linkIds.has(o.spaceB)) union(o.spaceA, o.spaceB);
      }
      const comps = new Map<string, string[]>();
      for (const id of linkIds) { const r = find(id); let a = comps.get(r); if (!a) { a = []; comps.set(r, a); } a.push(id); }
      const entryComp = (() => {
        for (const [r, ids] of comps) if (ids.some(id => { const s = spacesById.get(id); return s && (s.type === 'entrance' || s.type === 'foyer'); })) return r;
        return comps.keys().next().value as string;
      })();
      let merged = true;
      while (merged) {
        merged = false;
        const inComp = new Set<string>();
        for (const id of comps.get(entryComp) ?? []) inComp.add(id);
        let bestBridge: { score: number; spanW: number; key: string; outsideId: string } | null = null;
        for (const [key, walls] of pairWalls) {
          const [ida, idb] = key.split('|');
          if (!linkIds.has(ida) || !linkIds.has(idb)) continue;
          const aIn = inComp.has(ida), bIn = inComp.has(idb);
          if (aIn === bIn) continue;
          const a = spacesById.get(ida)!, b = spacesById.get(idb)!;
          const score = (circTypes.has(a.type) && circTypes.has(b.type)) ? 3
            : (circTypes.has(a.type) || circTypes.has(b.type)) ? 2 : 1;
          const pick = bestFreeWall(walls, DOOR_INT_WIDTH);
          if (!pick) continue;
          if (!bestBridge || score > bestBridge.score
            || (score === bestBridge.score && pick.span.width > bestBridge.spanW)
            || (score === bestBridge.score && Math.abs(pick.span.width - bestBridge.spanW) < 1e-9 && key < bestBridge.key)) {
            bestBridge = { score, spanW: pick.span.width, key, outsideId: aIn ? idb : ida };
          }
        }
        if (!bestBridge) break;
        const [ida, idb] = bestBridge.key.split('|');
        const a = spacesById.get(ida)!, b = spacesById.get(idb)!;
        const walls = pairWalls.get(bestBridge.key)!;
        const pick = bestFreeWall(walls, DOOR_INT_WIDTH);
        if (pick) {
          const into = circTypes.has(a.type) && !circTypes.has(b.type) ? b.id : a.id;
          placeDoorOnWall(pick.wall, into, DOOR_INT_WIDTH);
          union(ida, idb);
          comps.set(entryComp, [...(comps.get(entryComp) ?? []), ...(comps.get(find(ida)) ?? [])]);
          merged = true;
        }
        // consume the outside component fully next round
        for (const [r, ids] of [...comps.entries()]) if (r !== entryComp && ids.some(id => find(id) === entryComp)) comps.delete(r);
      }
    }
  }

  // 3) Intentional SECONDARY links — only for rooms that genuinely have no
  //    spine access, and only in architecturally-intended configurations:
  //      - master-bathroom through the master bedroom (suite),
  //      - a shared bath / WC through an adjacent bedroom (last-resort suite bath),
  //      - storage / utility through the kitchen (service).
  //    These become the room's primary then. NEVER bedroom<->bedroom, NEVER a
  //    room that already has spine access.
  for (const s of floor.spaces) {
    if (!needsDoor(s.type) || roomByPrimary.has(s.id)) continue;
    const isWet = WET.has(s.type), isStore = SERVICE_STORE.has(s.type);
    if (!isWet && !isStore) continue;
    const wantedPartner = isStore ? 'kitchen' : isWet && s.type === 'master-bathroom' ? 'master-bedroom' : 'bedroom|master-bedroom';
    let bestKey: string | null = null; let bestOther: Space | null = null;
    for (const [key, walls] of pairWalls) {
      if (!key.includes(s.id)) continue;
      const [ida, idb] = key.split('|');
      const other = spacesById.get(ida === s.id ? idb : ida)!;
      if (!other) continue;
      const ok = wantedPartner === 'kitchen' ? other.type === 'kitchen'
        : wantedPartner.includes('|') ? (other.type === 'bedroom' || other.type === 'master-bedroom')
        : other.type === wantedPartner;
      if (!ok) continue;
      if (!roomByPrimary.has(other.id) && circTypes.has(other.type) === false) {
        // partner itself must reach the spine somehow; otherwise this chain is pointless
        continue;
      }
      if (!bestKey || key < bestKey) { bestKey = key; bestOther = other; }
    }
    if (!bestKey || !bestOther) continue;
    const walls = pairWalls.get(bestKey)!;
    const width = doorWidthFor(s.type, bestOther.type);
    const pick = bestFreeWall(walls, width);
    if (!pick) continue;
    placeDoorOnWall(pick.wall, s.id, width);
    roomByPrimary.set(s.id, { key: bestKey, score: 1, wall: pick.wall, span: pick.span, otherId: bestOther.id });
  }

  // ---- Windows (professional) ----
  // Orientation preference: living/master-bedroom prefers south, bedroom east/west,
  // kitchen east or north, bathroom any but smallest.
  function orientationScore(wall: Wall, roomType: string): number {
    const side = wallSide(wall, floor.footprint);
    if (!side) return 0;
    switch (roomType) {
      case 'living':
        if (side === 'south') return 10;
        if (side === 'east' || side === 'west') return 6;
        return 2;
      case 'master-bedroom':
        if (side === 'south') return 10;
        if (side === 'east') return 8;
        if (side === 'west') return 5;
        return 1;
      case 'bedroom':
        if (side === 'east') return 9;
        if (side === 'west') return 7;
        if (side === 'south') return 6;
        return 2;
      case 'kitchen':
        if (side === 'east') return 9;
        if (side === 'north') return 7;
        if (side === 'south') return 4;
        return 3;
      case 'dining':
        if (side === 'south') return 8;
        if (side === 'east' || side === 'west') return 6;
        return 3;
      default:
        return 5;
    }
  }

  for (const s of floor.spaces) {
    if (!s.daylightRequired && s.type !== 'kitchen' && s.type !== 'bathroom' && s.type !== 'master-bathroom') continue;
    if (s.type === 'corridor' || s.type === 'stair-hall' || s.type === 'elevator-hall' || s.type === 'parking' || s.type === 'storage' || s.type === 'entrance' || s.type === 'foyer') continue;
    const extWalls = floor.walls.filter(w => w.kind === 'exterior' && w.spaceIds.includes(s.id));
    if (!extWalls.length) continue;
    // Sort by orientation preference + length
    extWalls.sort((a, b) => {
      const oa = orientationScore(a, s.type);
      const ob = orientationScore(b, s.type);
      if (oa !== ob) return ob - oa;
      return wallLength(b) - wallLength(a);
    });
    for (const w of extWalls) {
      const L = wallLength(w);
      // Window width based on room type
      let ratio = 0.55;
      let maxW = 2.4;
      if (s.type === 'living') { ratio = 0.65; maxW = 3.0; }
      else if (s.type === 'master-bedroom') { ratio = 0.6; maxW = 2.4; }
      else if (s.type === 'bedroom') { ratio = 0.5; maxW = 2.0; }
      else if (s.type === 'kitchen') { ratio = 0.45; maxW = 1.8; }
      else if (s.type === 'bathroom' || s.type === 'master-bathroom') { ratio = 0.35; maxW = 1.0; }
      const ww = Math.min(Math.max(WINDOW_MIN_WIDTH, L * ratio), maxW);
      const span = findFreeSpan(w, ww, 'middle', 0.5);
      if (!span) continue;
      const id = mkId('window');
      const center = pointAtOffset(w, span.offset + span.width / 2);
      // Sill height per room type
      let sill = WINDOW_SILL;
      if (s.type === 'bathroom' || s.type === 'master-bathroom') sill = 1.2;
      else if (s.type === 'kitchen') sill = 1.0;
      const op: Opening = {
        id, type: 'window', wallId: w.id, center,
        wallDir: wallDirection(w),
        normal: normalIntoSpace(w, s.id),
        width: ww, height: WINDOW_LINTEL - sill, sill,
        floor: floor.level,
        spaceA: w.spaceIds[0] ?? undefined, spaceB: w.spaceIds[1] ?? undefined,
      };
      openings.push(op);
      addOcc(w.id, span.offset, span.offset + span.width);
      w.openingIds.push(id);
      s.hasExteriorWall = true;
      break;
    }
  }

  return { openings, entranceWallId, entranceDoorId };
}
