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
        // Strongly prefer a wall whose interior space is circulation.
        // Between same-type walls prefer the longest (more comfortable entry).
        const score = (inside && circTypes.has(inside.type) ? 10000 : 0) + wallLength(w);
        return { w, inside, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const { w: wall, inside } of candidates) {
      // Entrance door margin smaller so we can fit on narrow facades; we only
      // need to stay clear of wall corners.
      const span = findFreeSpan(wall, DOOR_EXT_WIDTH, 'middle', 0.1);
      if (!span) continue;
      const id = mkId('entrance');
      entranceWallId = wall.id;
      entranceDoorId = id;
      const into: string | null = inside ? inside.id : (wall.spaceIds[0] ?? wall.spaceIds[1]);
      const normal = into ? normalIntoSpace(wall, into) : { x: 0, y: 1 };
      const center = pointAtOffset(wall, span.offset + span.width / 2);
      const op: Opening = {
        id, type: 'entrance', wallId: wall.id, center,
        wallDir: wallDirection(wall), normal,
        width: DOOR_EXT_WIDTH, height: DOOR_EXT_HEIGHT, sill: 0,
        swing: 'left', floor: floor.level,
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
    // For small walls (tight sites / bathrooms) use minimal corner margin so
    // doors can still fit. Otherwise use comfortable margin.
    const L = wallLength(wall);
    // Pick the largest margin that still leaves room for the door on this wall.
    const margin = L < width + 0.45 ? Math.max(0.02, (L - width) / 2 - 0.01) : 0.2;
    const span = findFreeSpan(wall, width, prefer, margin);
    if (!span) return;
    const id = mkId('door');
    const center = pointAtOffset(wall, span.offset + span.width / 2);
    const op: Opening = {
      id, type: 'door', wallId: wall.id, center,
      wallDir: wallDirection(wall), normal: normalIntoSpace(wall, intoSpaceId),
      width, height: DOOR_INT_HEIGHT, sill: 0,
      swing: 'left', floor: floor.level,
      spaceA: wall.spaceIds[0] ?? undefined, spaceB: wall.spaceIds[1] ?? undefined,
    };
    openings.push(op);
    addOcc(wall.id, span.offset, span.offset + span.width);
    wall.openingIds.push(id);
  }

  // Iterate interior walls; place doors where circulation is involved.
  const interiorWalls = floor.walls.filter(w => w.kind !== 'exterior' && w.spaceIds[0] && w.spaceIds[1]);
  // Order so we place corridor doors first (they take priority on wall
  // occupancy), then entrance/foyer, then stair-hall, then ensuite / other.
  // We prefer placing a door from a circulation space onto a SMALL room
  // (WC/bath) before placing onto larger rooms, since small-room walls are
  // shorter and more likely to become "occupied" by a larger-room door.
  const SMALL = new Set(['guest-wc', 'bathroom', 'master-bathroom', 'storage', 'utility']);
  function wallPri(w: Wall): [number, number] {
    const a = spacesById.get(w.spaceIds[0]!); const b = spacesById.get(w.spaceIds[1]!);
    const types = new Set([a?.type, b?.type]);
    let tier = 3;
    if (types.has('corridor')) tier = 0;
    else if (types.has('entrance') || types.has('foyer')) tier = 1;
    else if (types.has('stair-hall')) tier = 2;
    const smallSide = (a && SMALL.has(a.type)) || (b && SMALL.has(b.type)) ? 0 : 1;
    return [tier, smallSide];
  }
  const sortedWalls = [...interiorWalls].sort((a, b) => {
    const [ta, sa] = wallPri(a); const [tb, sb] = wallPri(b);
    return ta - tb || sa - sb;
  });
  for (const w of sortedWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b) continue;
    if (a.type === 'parking' || b.type === 'parking') continue;
    if (a.type === 'yard' || b.type === 'yard') continue;
    if (a.type === 'balcony' || b.type === 'balcony') continue;
    const aCirc = circTypes.has(a.type);
    const bCirc = circTypes.has(b.type);
    if (aCirc || bCirc) {
      // Door opens INTO the non-circulation side. For circulation-to-
      // circulation, direction is arbitrary (foyer→corridor etc).
      const into = aCirc && bCirc ? b.id : aCirc ? b.id : a.id;
      const isBathDoor = (a.type === 'bathroom' || a.type === 'master-bathroom' || a.type === 'guest-wc'
                      || b.type === 'bathroom' || b.type === 'master-bathroom' || b.type === 'guest-wc');
      // Place door as close as possible to the circulation side's
      // "corner" with the main corridor/entrance spine? For corridor walls
      // in a north/south-aligned column, we want the door near the corridor
      // (for south-band column walls which are VERTICAL, 'start' = bottom
      // = corridor side; for north-band column 'end' = bottom = corridor
      // side). Without complicating too much we just pass middle (default).
      placeDoorOnWall(w, into, isBathDoor ? DOOR_BATH_WIDTH : DOOR_INT_WIDTH);
    }
  }
  // Additionally, connect master-bathroom to master-bedroom when they share a wall,
  // and connect chained rooms (guest-WC opening off entrance/foyer; secondary
  // bedrooms off master-bedroom when no corridor wall is adjacent).
  function hasCircDoor(s: Space): boolean {
    for (const wid of s.wallIds) {
      const ww = floor.walls.find(www => www.id === wid);
      if (!ww) continue;
      if (ww.openingIds.length === 0) continue;
      const other = ww.spaceIds.find(id => id && id !== s.id);
      if (!other) continue;
      const o = spacesById.get(other);
      if (o && circTypes.has(o.type)) return true;
    }
    return false;
  }
  // 1. Ensuite bathrooms.
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b) continue;
    const isEnsuite =
      (a.type === 'master-bathroom' && b.type === 'master-bedroom') ||
      (b.type === 'master-bathroom' && a.type === 'master-bedroom');
    if (isEnsuite && w.openingIds.length === 0) {
      placeDoorOnWall(w, b.type === 'master-bathroom' ? b.id : a.id, DOOR_BATH_WIDTH);
    }
  }
  // 2. Guest-WC opens off entrance/foyer if it shares a wall with one and
  //    does not already have a circulation door.
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b || w.openingIds.length > 0) continue;
    const isWc = (a.type === 'guest-wc') !== (b.type === 'guest-wc');
    if (!isWc) continue;
    const wc = a.type === 'guest-wc' ? a : b;
    const other = a.type === 'guest-wc' ? b : a;
    if (circTypes.has(other.type) && !hasCircDoor(wc)) {
      placeDoorOnWall(w, wc.id, DOOR_BATH_WIDTH);
    }
  }
  // 3. Bedrooms without a circulation door connect to adjacent bedroom
  //    (e.g. secondary bedroom opens off master bedroom when no corridor
  //    boundary exists on a tight/short north band).
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b || w.openingIds.length > 0) continue;
    const isBed = ['bedroom', 'master-bedroom'].includes(a.type) && ['bedroom', 'master-bedroom'].includes(b.type);
    if (!isBed) continue;
    // If one bedroom has no circulation door, add a connecting door
    // between them (bedroom suite). This keeps circulation connected.
    if (!hasCircDoor(a) || !hasCircDoor(b)) {
      const into = !hasCircDoor(a) ? a.id : b.id;
      placeDoorOnWall(w, into, DOOR_INT_WIDTH);
    }
  }
  // 4. Storage / pantry / utility connects to kitchen (its only natural
  //    adjacency) so storage is reachable via the kitchen's circulation door.
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b || w.openingIds.length > 0) continue;
    const isKitchenStorage =
      ((a.type === 'kitchen' && b.type === 'storage') ||
       (b.type === 'kitchen' && a.type === 'storage'));
    if (!isKitchenStorage) continue;
    const stor = a.type === 'storage' ? a : b;
    if (!hasCircDoor(stor)) {
      placeDoorOnWall(w, stor.id, DOOR_BATH_WIDTH);
    }
  }
  // 5. Kitchen connects to dining if they share a wall (open-plan pass) and
  //    kitchen doesn't have a direct circulation door (e.g. L-shaped layout
  //    where kitchen is on the side facade and dining reaches corridor).
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b || w.openingIds.length > 0) continue;
    const isKitDin =
      ((a.type === 'kitchen' && b.type === 'dining') ||
       (b.type === 'kitchen' && a.type === 'dining'));
    if (!isKitDin) continue;
    const kit = a.type === 'kitchen' ? a : b;
    if (!hasCircDoor(kit)) {
      placeDoorOnWall(w, kit.id, DOOR_INT_WIDTH);
    }
  }
  // 6. Second bathroom (bathroom type) opens off master bedroom or another
  //    bedroom if it is not adjacent to circulation.
  for (const w of interiorWalls) {
    const a = spacesById.get(w.spaceIds[0]!);
    const b = spacesById.get(w.spaceIds[1]!);
    if (!a || !b || w.openingIds.length > 0) continue;
    const isBathPair =
      ((a.type === 'bathroom' || a.type === 'master-bathroom') &&
       (b.type === 'bedroom' || b.type === 'master-bedroom')) ||
      ((b.type === 'bathroom' || b.type === 'master-bathroom') &&
       (a.type === 'bedroom' || a.type === 'master-bedroom'));
    if (!isBathPair) continue;
    const bath = (a.type === 'bathroom' || a.type === 'master-bathroom') ? a : b;
    if (!hasCircDoor(bath)) {
      placeDoorOnWall(w, bath.id, DOOR_BATH_WIDTH);
    }
  }

  // ---- Windows ----
  for (const s of floor.spaces) {
    if (!s.daylightRequired && s.type !== 'kitchen' && s.type !== 'bathroom' && s.type !== 'master-bathroom') continue;
    if (s.type === 'corridor' || s.type === 'stair-hall' || s.type === 'elevator-hall' || s.type === 'parking' || s.type === 'storage' || s.type === 'entrance' || s.type === 'foyer') continue;
    // Find an exterior wall of this room; prefer the one best oriented for daylight.
    const extWalls = floor.walls.filter(w => w.kind === 'exterior' && w.spaceIds.includes(s.id));
    if (!extWalls.length) continue;
    // Pick the longest exterior wall for the window.
    extWalls.sort((a, b) => wallLength(b) - wallLength(a));
    for (const w of extWalls) {
      const L = wallLength(w);
      // window width ~60% of wall length, capped
      const ww = Math.min(Math.max(WINDOW_MIN_WIDTH, L * 0.55), 2.4);
      const span = findFreeSpan(w, ww, 'middle', 0.5);
      if (!span) continue;
      const id = mkId('window');
      const center = pointAtOffset(w, span.offset + span.width / 2);
      const op: Opening = {
        id, type: 'window', wallId: w.id, center,
        wallDir: wallDirection(w),
        normal: normalIntoSpace(w, s.id),
        width: ww, height: WINDOW_LINTEL - WINDOW_SILL, sill: WINDOW_SILL,
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
