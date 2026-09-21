/**
 * Phase 15 M5 — MEASUREMENT (scratch): quantifies circulation quality of every FEASIBLE
 * winner across the 560-case stress matrix (door-graph derived, same as validators see).
 */
import { buildStressCases } from '../dist/stress/matrix.js';
import { createProject, generate } from '../dist/pipeline.js';

const CIRC = new Set(['entrance','foyer','corridor','stair-hall','elevator-hall']);
const PRIVATE = new Set(['bedroom','master-bedroom','bathroom','master-bathroom','guest-wc']);
const WET = new Set(['bathroom','master-bathroom','guest-wc']);
const HABIT = new Set(['living','dining','kitchen','bedroom','master-bedroom','family-room','guest-room']);

function floorMetrics(floor) {
  const m = { throughPrivate:0, bedToBedDoors:0, bathViaBedNoHall:0, redundantPairs:0, entryIntoPrivate:0, multiDoorRoom:0, stairUpperNoCircDoor:0, orphan:0, redundantInter:0, longPath:0, shortcutDining:0 };
  const byId = new Map(floor.spaces.map(s=>[s.id,s]));
  const adj = new Map(floor.spaces.map(s=>[s.id,new Set()]));
  const pairDoors = new Map();
  const doorsBySpace = new Map(floor.spaces.map(s=>[s.id,[]]));
  const doors = floor.openings.filter(o=>o.type==='door'||o.type==='entrance'||o.type==='sliding-door');
  for (const o of doors) {
    const a = o.spaceA && byId.get(o.spaceA); const b = o.spaceB && byId.get(o.spaceB);
    if (!a || !b) continue;
    adj.get(a.id).add(b.id); adj.get(b.id).add(a.id);
    const key = [a.id,b.id].sort().join('|');
    pairDoors.set(key, (pairDoors.get(key)??0)+1);
    doorsBySpace.get(a.id).push(o); doorsBySpace.get(b.id).push(o);
    if (o.type === 'entrance') {
      const inner = a.type==='entrance'? b : a;
      if (PRIVATE.has(inner.type)) m.entryIntoPrivate++;
      if (inner.type==='living'||inner.type==='dining') m.shortcutDining++;
    }
    if (['bedroom','master-bedroom'].includes(a.type) && ['bedroom','master-bedroom'].includes(b.type)) m.bedToBedDoors++;
  }
  for (const [,n] of pairDoors) if (n > 1) m.redundantPairs++;
  // shortest path from entrance seeds
  const seeds = floor.spaces.filter(s=>s.type==='entrance'||s.type==='foyer').map(s=>s.id);
  const seedList = seeds.length? seeds : floor.spaces.filter(s=>CIRC.has(s.type)).map(s=>s.id);
  const dist = new Map(seedList.map(id=>[id,0])); const prev = new Map();
  const q = [...seedList];
  while (q.length) { const id = q.shift(); for (const n of adj.get(id)??[]) if (!dist.has(n)) { dist.set(n, dist.get(id)+1); prev.set(n, id); q.push(n); } }
  for (const s of floor.spaces) {
    if (CIRC.has(s.type)||s.type==='parking'||s.type==='yard'||s.type==='balcony'||s.type==='storage'||s.type==='utility') continue;
    // FORCED through-room: room has no door to any circulation space (suite exemptions),
    // i.e. every entrance into it is through another non-circulation room.
    const ds = doorsBySpace.get(s.id) ?? [];
    const hasCircDoor = ds.some(o => { const other = byId.get(o.spaceA===s.id?o.spaceB:o.spaceA); return other && CIRC.has(other.type); });
    const isMasterBath = s.type==='master-bathroom';
    const isStorage = s.type==='storage'||s.type==='utility';
    const suiteExempt = (isMasterBath||isStorage) && ds.length>0;
    if (!hasCircDoor && !suiteExempt) {
      // does its only access go through a private/habitable room? (not just wet/storage partner)
      const others = ds.map(o=>byId.get(o.spaceA===s.id?o.spaceB:o.spaceA)).filter(Boolean);
      if (others.some(o=>['bedroom','master-bedroom','living','dining','kitchen'].includes(o.type))) m.throughPrivate++;
      else if (others.length===0) m.orphan++;
    }
    // shortcut through: has direct circ door but BFS took a room path — indicates redundant inter-room doors
    if (hasCircDoor && ds.length>0) {
      for (const o of ds) { const other = byId.get(o.spaceA===s.id?o.spaceB:o.spaceA); if (other && !CIRC.has(other.type) && !['master-bathroom','bathroom','storage','utility','guest-wc'].includes(other.type===s.type?'x':other.type)) m.redundantInter++; }
    }
    // path hops from entrance (shortest)
    { let cur=s.id, hops=0; const seen=new Set();
      while (cur!==undefined && !seedList.includes(cur) && hops<12 && !seen.has(cur)) { seen.add(cur); cur=prev.get(cur); hops++; }
      if (hops>3) m.longPath++; }
    // bath whose only doors are to a bedroom but shares a wall with circulation
    if (WET.has(s.type)) {
      const ds = doorsBySpace.get(s.id) ?? [];
      const onlyBed = ds.length > 0 && ds.every(o => { const other = byId.get(o.spaceA===s.id?o.spaceB:o.spaceA); return other && ['bedroom','master-bedroom'].includes(other.type); });
      if (onlyBed) {
        const touchesCirc = (s.wallIds ?? []).length >= 0 && floor.spaces.some(c => CIRC.has(c.type) && (c.wallIds??[]).length && Math.abs(c.rect.x-s.rect.x) <= Math.max(c.rect.w,s.rect.w)+0.01 && Math.abs(c.rect.x+c.rect.w-(s.rect.x+s.rect.w)) <= Math.max(c.rect.w,s.rect.w)+0.01 ? (Math.abs(c.rect.y+c.rect.h-s.rect.y)<0.01||Math.abs(s.rect.y+s.rect.h-c.rect.y)<0.01||Math.abs(c.rect.x+c.rect.w-s.rect.x)<0.01||Math.abs(s.rect.x+s.rect.w-c.rect.x)<0.01) : false);
        if (touchesCirc) m.bathViaBedNoHall++;
      }
    }
    if ((doorsBySpace.get(s.id)??[]).filter(o=>o.type==='door').length > 2) m.multiDoorRoom++;
  }
  if (floor.level > 0) {
    for (const st of floor.spaces.filter(s=>s.type==='stair-hall'||s.type==='elevator-hall')) {
      const hasCircDoor = (doorsBySpace.get(st.id)??[]).some(o => { const other = byId.get(o.spaceA===st.id?o.spaceB:o.spaceA); return other && CIRC.has(other.type); });
      if (!hasCircDoor) m.stairUpperNoCircDoor++;
    }
  }
  return m;
}

const cases = buildStressCases();
const totals = {}; const examples = []; let feas = 0, winnersWithDoors = 0;
for (const c of cases) {
  let out; try { out = generate(createProject(c.input), { allStrategies: true }); } catch { continue; }
  const p = out.bestCandidate; if (!p) continue; feas++;
  winnersWithDoors++;
  for (const f of p.floors ?? []) {
    const m = floorMetrics(f);
    for (const [k,v] of Object.entries(m)) { totals[k] = (totals[k]??0)+v; if (v>0 && k!=='bedToBedDoors' && examples.length<18) examples.push(`${c.id} F${f.level} ${k}:${v}`); }
    let doors = 0; for (const fl of p.floors) doors += (fl.openings??[]).filter(o=>o.type==='door').length;
    totals.totalIntDoors = (totals.totalIntDoors??0);
  }
}
totals.feasible = feas; totals.cases = cases.length;
console.log(JSON.stringify(totals, null, 1));
console.log('examples:', examples.slice(0,18).join(' | '));
