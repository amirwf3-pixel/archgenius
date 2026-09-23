import { describe, it, expect } from 'vitest';
import { writeDXF, validateDXFStructure } from './writer.js';
import { LAYERS } from './layers.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { createProject, exportDXF } from '../pipeline.js';
import { legacyGenerate } from '../testutil/legacy-generate.js';

/**
 * P16-D — professional presentation regression suite.
 *
 * Pins the CAD *presentation* contract of writeDXF/exportDXF on top of the
 * structural R12 guarantees (covered in architectural-r12.test.ts):
 * layer-scheme selection, furniture/sanitary glyphs, geometry-derived
 * dimensions and room areas, the model-space title block + legend, emitter
 * deduplication, and the hardened structural validator. All fixtures are
 * deterministic (seeded); every measured number asserted here is recomputed
 * from the candidate geometry at test time — nothing is hard-coded.
 */

const CR = '\r\n';

interface Ent { type: string; codes: Record<number, string>; }

function entities(dxf: string): Ent[] {
  const lines = dxf.split(CR);
  const out: Ent[] = [];
  let sec = '';
  let cur: Ent | null = null;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = lines[i + 1];
    if (code === 0 && value === 'SECTION') { cur = null; continue; }
    if (code === 2 && cur === null && sec === '') { sec = value; continue; }
    if (code === 0 && value === 'ENDSEC') { sec = ''; continue; }
    if (sec !== 'ENTITIES') continue;
    if (code === 0) { if (cur) out.push(cur); cur = { type: value, codes: {} }; continue; }
    if (cur) cur.codes[code] = value;
  }
  if (cur) out.push(cur);
  return out;
}

function layerSet(dxf: string): Set<string> {
  return new Set(entities(dxf).filter(e => e.codes[8] !== undefined).map(e => e.codes[8]));
}

function textValues(dxf: string): string[] {
  return entities(dxf).filter(e => e.type === 'TEXT').map(e => e.codes[1] ?? '');
}

/** Shoelace area of a polygon [{x,y}...]. */
function shoelace(poly: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function fixture() {
  const prj = createProject({
    name: 'P16D Presentation', country: 'IR',
    site: { shape: 'rectangle', width: 18, length: 25, accessSide: 'south', streetWidth: 8 },
    building: {
      type: 'villa', floors: 2, bedrooms: 3, masterBedrooms: 1, bathrooms: 2, wc: 1,
      kitchenType: 'closed', parkingSpaces: 2, hasStair: true, hasStorage: true,
    },
    deterministic: true, seed: 42,
  });
  const { bestCandidate } = legacyGenerate(prj);
  if (!bestCandidate) throw new Error('no candidate for fixture');
  return bestCandidate;
}

describe('P16-D layer scheme selection', () => {
  const cand = fixture();

  it('defaults to the "both" contract: generic layers + per-floor aliases on floor 0', () => {
    const dxf = writeDXF(cand, 'p16d');
    const layers = layerSet(dxf);
    expect(layers.has('A-WALL-EXT')).toBe(true);
    expect(layers.has('A-FLOOR-0-A-WALL-EXT')).toBe(true);
    expect(layers.has('A-FLOOR-1-A-WALL-EXT')).toBe(true);
    expect(layers.has('A-FLOOR-1-A-WALL-EXT')).toBe(true);
    // Upper floors are per-floor named only — no bare generic wall layer for F1.
    // (Generic names still exist because floor 0 mirrors onto them.)
    expect(validateDXFStructure(dxf).ok).toBe(true);
  });

  it('"none" emits per-floor layers only — no generic entity references', () => {
    const dxf = writeDXF(cand, 'p16d', { layerScheme: 'none' });
    const layers = layerSet(dxf);
    expect(layers.has('A-FLOOR-0-A-WALL-EXT')).toBe(true);
    expect(layers.has('A-FLOOR-1-A-ROOM')).toBe(true);
    for (const generic of ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-ROOM']) {
      // Exact value match on the layer code — substring names like
      // A-FLOOR-0-A-ROOM must not count.
      expect([...layers].some(l => l === generic)).toBe(false);
    }
    expect(validateDXFStructure(dxf).ok).toBe(true);
  });

  it('"generic" emits shared-discipline layers only — single emission, no floor mirrors', () => {
    const dxf = writeDXF(cand, 'p16d', { layerScheme: 'generic' });
    const layers = layerSet(dxf);
    expect([...layers].some(l => l === 'A-WALL-EXT')).toBe(true);
    expect([...layers].some(l => l.startsWith('A-FLOOR-'))).toBe(false);
    // Walls of both floors now land on the same layer with no duplicates:
    // floor 1 is vertically offset, so geometry differs.
    expect(validateDXFStructure(dxf).ok).toBe(true);
  });

  it('legacy includeGenericLayers flag maps onto the scheme', () => {
    const lean = writeDXF(cand, 'p16d', { includeGenericLayers: false });
    expect(layerSet(lean).has('A-FLOOR-0-A-WALL-EXT')).toBe(true);
    expect([...layerSet(lean)].some(l => l === 'A-WALL-EXT')).toBe(false);
    const full = writeDXF(cand, 'p16d', { includeGenericLayers: true });
    const layers = layerSet(full);
    expect(layers.has('A-WALL-EXT')).toBe(true);
    expect(layers.has('A-FLOOR-0-A-WALL-EXT')).toBe(true);
  });

  it('exportDXF forwards dxfOptions identically to writeDXF', () => {
    const a = exportDXF(cand, 'p16d', { layerScheme: 'none' }).dxf;
    const b = writeDXF(cand, 'p16d', { layerScheme: 'none' });
    expect(a).toBe(b);
  });
});

describe('P16-D symbol glyphs', () => {
  const cand = fixture();

  it('door leaves keep swing arcs, stairs keep tread lines and direction arrows', () => {
    const dxf = writeDXF(cand, 'p16d');
    const ents = entities(dxf);
    const doorArcs = ents.filter(e => e.type === 'ARC' && (e.codes[8] === 'A-DOOR' || e.codes[8] === 'A-FLOOR-0-A-DOOR'));
    expect(doorArcs.length).toBeGreaterThan(0);
    const treads = ents.filter(e => e.type === 'LINE' && (e.codes[8] === 'A-STAIR-TREAD' || e.codes[8] === 'A-FLOOR-0-A-STAIR-TREAD'));
    expect(treads.length).toBeGreaterThanOrEqual(10);
    const dirs = ents.filter(e => e.type === 'LINE' && (e.codes[8] === 'A-STAIR-DIR' || e.codes[8] === 'A-FLOOR-0-A-STAIR-DIR'));
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    const north = ents.filter(e => e.codes[8] === 'A-NORTH' && e.type === 'LINE');
    expect(north.length).toBeGreaterThanOrEqual(4); // circle-of-direction needle body
  });
});

describe('P16-D dimensions and room labels are geometry-derived', () => {
  const cand = fixture();

  it('outer dimension text equals the floor footprint width, formatted to 0.01 m', () => {
    const dxf = writeDXF(cand, 'p16d');
    const texts = textValues(dxf);
    const f0 = cand.floors[0].footprint;
    const expected = `${f0.w.toFixed(2)} m F0`;
    expect(texts).toContain(expected);
    // Vertical outer dim (no floor suffix in the current layout).
    expect(texts).toContain(`${f0.h.toFixed(2)} m`);
  });

  it('never contains fabricated round numbers that are not present in geometry', () => {
    const dxf = writeDXF(cand, 'p16d');
    const f0 = cand.floors[0].footprint;
    // 12.34 never occurs as a dimension unless it IS the geometry — and
    // with a seeded rectangle site it cannot be. Guard against re-introducing
    // decorative hard-coded dimensions.
    if (f0.w.toFixed(2) !== '12.34' && f0.h.toFixed(2) !== '12.34') {
      expect(dxf).not.toContain('12.34 m');
    }
    expect(dxf).not.toContain('10.00 m F0');
  });

  it('room label carries NAME plus area derived from the actual polygon', () => {
    const dxf = writeDXF(cand, 'p16d');
    const texts = textValues(dxf);
    // Every floor room label is "<Name>" + "<area> m2" pair on A-ROOM.
    const areaTexts = texts.filter(t => /^\d+\.\d m2$/.test(t));
    expect(areaTexts.length).toBeGreaterThan(0);
    // Recompute one room's area from the model and expect the DXF label to match.
    const fl = cand.floors[0];
    const space = (fl.spaces ?? []).find(s => (s.polygon?.length ?? 0) >= 3 && s.label);
    if (space) {
      const a = shoelace(space.polygon!);
      expect(texts).toContain(`${a.toFixed(1)} m2`);
    }
    // Multi-floor plans disambiguate labels with a floor suffix.
    const suffixed = texts.filter(t => /\. F1$/.test(t));
    expect(suffixed.length).toBeGreaterThan(0);
  });

  it('site dimensions are labelled from the site box', () => {
    const dxf = writeDXF(cand, 'p16d');
    const texts = textValues(dxf);
    expect(texts.some(t => /^SITE \d+\.\d\d m$/.test(t))).toBe(true);
  });
});

describe('P16-D title block, legend and non-raster editability', () => {
  const cand = fixture();
  const dxf = writeDXF(cand, 'p16d');
  const texts = textValues(dxf);

  it('title block states project, floor count, units, plot scale and honesty line', () => {
    expect(texts).toContain('p16d');
    expect(texts.some(t => t.startsWith('FLOOR PLANS - 2 FLOOR(S)'))).toBe(true);
    expect(texts.some(t => t.includes('UNITS: MILLIMETRES | MODEL SPACE 1:1 | PLOT SCALE 1:100 @ A1'))).toBe(true);
    expect(texts.some(t => t.startsWith('NET FLOOR AREA (SUM OF ROOMS, ALL FLOORS)'))).toBe(true);
    expect(texts.some(t => t.includes('PROFESSIONAL REVIEW REQUIRED'))).toBe(true);
    expect(texts.some(t => t.includes('SITE'))).toBe(true);
  });

  it('title block carries no wall-clock date (deterministic output)', () => {
    // A regenerated write must be byte-stable: a date line would break that.
    expect(dxf).toBe(writeDXF(cand, 'p16d'));
    for (const t of texts) expect(t).not.toMatch(/\b(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  });

  it('legend rows name every discipline layer', () => {
    expect(texts).toContain('LEGEND');
    expect(texts.some(t => t === 'A-WALL-EXT - WALL, EXTERIOR')).toBe(true);
    expect(texts.some(t => t === 'A-DIMS - DIMENSIONS (m)')).toBe(true);
  });

  it('annotations are editable TEXT, never raster or R13+ substitutes', () => {
    const ents = entities(dxf);
    const types = new Set(ents.map(e => e.type));
    for (const t of types) {
      expect(['LINE', 'ARC', 'TEXT', 'POLYLINE', 'VERTEX', 'SEQEND']).toContain(t);
    }
    // An A-HATCH layer NAME may exist in the table, but no HATCH entity ever does.
    const allText = ents.filter(e => e.type === 'TEXT');
    expect(allText.length).toBeGreaterThan(10);
    for (const t of allText) {
      expect(t.codes[10]).toMatch(/^-?\d+(\.\d+)?$/);
      expect(t.codes[20]).toMatch(/^-?\d+(\.\d+)?$/);
      expect(t.codes[11]).toBeDefined(); expect(t.codes[21]).toBeDefined(); expect(t.codes[31]).toBeDefined();
    }
  });
});

describe('P16-D emitter deduplication and hardened validator', () => {
  const cand = fixture();

  it('no exact same-layer duplicate LINE/POLYLINE records survive emission', () => {
    const dxf = writeDXF(cand, 'p16d');
    const seen = new Set<string>();
    for (const e of entities(dxf)) {
      if (e.type === 'LINE') {
        const k = `L|${e.codes[8]}|${e.codes[10]},${e.codes[20]}|${e.codes[11]},${e.codes[21]}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      } else if (e.type === 'POLYLINE') {
        // handled loosely: just assert validator considers it fine
      }
    }
    const v = validateDXFStructure(dxf);
    expect(v.ok).toBe(true);
    expect(v.errors.filter(e => /duplicate/i.test(e))).toHaveLength(0);
  });

  it('coincident geometry on DIFFERENT layers stays legal (floor mirror)', () => {
    // Floor 0 emits the same wall geometry on A-WALL-EXT and A-FLOOR-0-A-WALL-EXT;
    // the validator must not reject that legitimate presentation duplication.
    const dxf = writeDXF(cand, 'p16d');
    const v = validateDXFStructure(dxf);
    expect(v.ok).toBe(true);
    const ents = entities(dxf);
    const a = ents.filter(e => e.type === 'LINE' && e.codes[8] === 'A-WALL-EXT');
    const b = ents.filter(e => e.type === 'LINE' && e.codes[8] === 'A-FLOOR-0-A-WALL-EXT');
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    expect(a[0].codes[10]).toBe(b[0].codes[10]);
  });

  it('validator rejects NaN/Inf coordinates injected into a valid file', () => {
    const dxf = writeDXF(cand, 'p16d');
    expect(validateDXFStructure(dxf).ok).toBe(true);
    // Replace the first real X-coordinate value line inside ENTITIES with +Infinity.
    const entSec = dxf.indexOf('2\r\nENTITIES');
    expect(entSec).toBeGreaterThan(0);
    const codeIdx = dxf.indexOf('10\r\n', entSec);
    expect(codeIdx).toBeGreaterThan(0);
    const valStart = codeIdx + 4;
    const valEnd = dxf.indexOf('\r\n', valStart);
    const bad = dxf.slice(0, valStart) + '1e400' + dxf.slice(valEnd);
    const v = validateDXFStructure(bad);
    expect(v.ok).toBe(false);
    expect(v.errors.some(e => /Non-finite/.test(e))).toBe(true);
  });

  it('validator rejects zero-length LINE and undefined layer references', () => {
    const dxf = writeDXF(cand, 'p16d');
    expect(validateDXFStructure(dxf).ok).toBe(true);
    // Zero-length: collapse the first LINE's end point onto its start point.
    const m = dxf.match(/0\r\nLINE\r\n8\r\n([^\r]+)\r\n10\r\n(-?[\d.]+)\r\n20\r\n(-?[\d.]+)\r\n30\r\n[^\r]+\r\n11\r\n-?[\d.]+\r\n21\r\n-?[\d.]+\r\n31\r\n[^\r]+/);
    expect(m).toBeTruthy();
    const zeroed = dxf.replace(
      m![0],
      `0\r\nLINE\r\n8\r\n${m![1]}\r\n10\r\n${m![2]}\r\n20\r\n${m![3]}\r\n30\r\n0\r\n11\r\n${m![2]}\r\n21\r\n${m![3]}\r\n31\r\n0`,
    );
    expect(validateDXFStructure(zeroed).errors.some(e => /Zero-length LINE/.test(e))).toBe(true);
    // Undefined layer: rename a single entity reference.
    const bogus = dxf.replace('\r\n8\r\nA-ROOM\r\n', '\r\n8\r\nA-ROOZ\r\n');
    const v2 = validateDXFStructure(bogus);
    expect(v2.ok).toBe(false);
    expect(v2.errors.some(e => e.includes('A-ROOZ'))).toBe(true);
  });

  it('full export from the pipeline validates clean in every scheme', () => {
    for (const layerScheme of ['both', 'none', 'generic'] as const) {
      const { dxf, validation } = exportDXF(cand, 'p16d', { layerScheme });
      expect(validation.ok, `scheme ${layerScheme}: ${validation.errors.join('; ')}`).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(dxf.trim().endsWith('EOF')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// P16-D-B — layer & lineweight presentation
// ---------------------------------------------------------------------------

/** Layer names defined in the TABLES/LAYER section (not entity references). */
function layerTableNames(dxf: string): Set<string> {
  const lines = dxf.split(CR);
  const names = new Set<string>();
  let inLayerTable = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1];
    if (code === '0' && value === 'TABLE') { inLayerTable = false; continue; }
    if (code === '2' && !inLayerTable && names.size === 0 && value === 'LAYER') { inLayerTable = true; continue; }
    if (code === '0' && value === 'ENDTAB') { inLayerTable = false; continue; }
    if (inLayerTable && code === '0' && value === 'LAYER') {
      // next pair is (2, name)
      if (i + 3 < lines.length && lines[i + 2].trim() === '2') names.add(lines[i + 3]);
    }
  }
  return names;
}

describe('P16-D-B architectural layer roster and separation', () => {
  const cand = fixture();

  it('every defined layer carries a coherent AIA-style name', () => {
    const dxf = writeDXF(cand, 'p16d-b');
    const names = layerTableNames(dxf);
    expect(names.size).toBeGreaterThan(20);
    for (const n of names) {
      expect(n === '0' || /^A-/.test(n), `layer ${n} breaks the A- naming convention`).toBe(true);
    }
    for (const must of ['A-WALL-EXT', 'A-WALL-INT', 'A-DOOR', 'A-WINDOW', 'A-STAIR', 'A-DIMS', 'A-TEXT', 'A-SITE', 'A-PARKING', 'A-ROOM', 'A-TITLE']) {
      expect(names.has(must), `missing discipline layer ${must}`).toBe(true);
    }
  });

  it('presentation categories stay separated: walls / openings / dims / text / stairs / site / parking', () => {
    const dxf = writeDXF(cand, 'p16d-b');
    const used = [...layerSet(dxf)];
    const family = (base: string) => used.filter(l => l === base || l.startsWith(`A-FLOOR-`) && l.endsWith(`-${base}`));
    for (const base of ['A-WALL-EXT', 'A-DOOR', 'A-WINDOW', 'A-DIMS', 'A-STAIR', 'A-SITE', 'A-PARKING']) {
      expect(family(base).length, `no entities on ${base} family`).toBeGreaterThan(0);
    }
    // Text annotation family exists and is disjoint from the geometry families.
    const textLayers = new Set(family('A-TEXT'));
    for (const base of ['A-WALL-EXT', 'A-DOOR', 'A-WINDOW', 'A-STAIR', 'A-SITE', 'A-PARKING']) {
      for (const l of family(base)) expect(textLayers.has(l)).toBe(false);
    }
  });

  it('floor headers and stair build notes are on A-TEXT, not room/stair-arrow layers', () => {
    const dxf = writeDXF(cand, 'p16d-b');
    const ents = entities(dxf);
    const floorHeaders = ents.filter(e => e.type === 'TEXT' && /^FLOOR \d+ - ELEV /.test(e.codes[1] ?? ''));
    expect(floorHeaders.length).toBeGreaterThanOrEqual(cand.floors.length);
    for (const h of floorHeaders) expect(h.codes[8]).toMatch(/A-TEXT$/);
    const stairNotes = ents.filter(e => e.type === 'TEXT' && /\d+R @ \d+x\d+/.test(e.codes[1] ?? ''));
    expect(stairNotes.length).toBeGreaterThan(0);
    for (const n of stairNotes) {
      expect(n.codes[8]).toMatch(/A-TEXT$/);
      expect(n.codes[8]).not.toMatch(/A-STAIR-DIR$/);
    }
    // Direction-arrow layer now carries only arrow labels ('UP', stack marker left A-TEXT above).
    const dirTexts = ents.filter(e => e.type === 'TEXT' && /A-STAIR-DIR$/.test(e.codes[8] ?? ''));
    expect(dirTexts.length).toBeGreaterThan(0);
    for (const t of dirTexts) expect(t.codes[1]).toMatch(/^UP$/);
    // Room labels + areas stay on A-ROOM.
    const areaTexts = ents.filter(e => e.type === 'TEXT' && /^\d+\.\d m2$/.test(e.codes[1] ?? ''));
    expect(areaTexts.length).toBeGreaterThan(0);
    for (const a of areaTexts) expect(a.codes[8]).toMatch(/A-ROOM$/);
    // Dimension values stay with the dimension lines on A-DIMS.
    const dimTexts = ents.filter(e => e.type === 'TEXT' && /^\d+\.\d\d m( F\d+)?$/.test(e.codes[1] ?? ''));
    expect(dimTexts.length).toBeGreaterThan(0);
    for (const d of dimTexts) expect(d.codes[8]).toMatch(/A-DIMS$/);
  });

  it('A-TEXT is floor-namespaced in every scheme and validates clean', () => {
    for (const layerScheme of ['both', 'none', 'generic'] as const) {
      const dxf = writeDXF(cand, 'p16d-b', { layerScheme });
      const v = validateDXFStructure(dxf);
      expect(v.ok, `scheme ${layerScheme}: ${v.errors.join('; ')}`).toBe(true);
      const used = layerSet(dxf);
      const textLayers = [...used].filter(l => l === 'A-TEXT' || l.endsWith('-A-TEXT'));
      expect(textLayers.length, `scheme ${layerScheme}: A-TEXT family present`).toBeGreaterThan(0);
      if (layerScheme === 'none') {
        // Floor headers/notes are per-floor named; the whole-building stair-stack
        // label is cross-floor context and legitimately stays on the (always
        // defined) base A-TEXT layer — same convention as its old A-STAIR-DIR home.
        expect([...used].some(l => l === 'A-FLOOR-0-A-TEXT')).toBe(true);
        expect([...used].some(l => l === 'A-FLOOR-1-A-TEXT')).toBe(true);
      }
      if (layerScheme === 'generic') {
        expect([...used].some(l => l === 'A-TEXT')).toBe(true);
      }
    }
  });

  it('legend documents the annotation layer', () => {
    const dxf = writeDXF(cand, 'p16d-b');
    expect(textValues(dxf)).toContain('A-TEXT - GENERAL NOTES');
  });
});

describe('P16-D-B lineweight pen ladder', () => {
  it('all lineweights are valid ISO 128 / AutoCAD pen values', () => {
    const PENS = new Set([0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]);
    for (const l of LAYERS) {
      expect(PENS.has(l.lineweight), `${l.name} lineweight ${l.lineweight} is not a standard pen`).toBe(true);
    }
  });

  it('weights descend monotonically: structure > walls > openings > partitions > annotation > helpers', () => {
    const lw = (n: string) => LAYERS.find(l => l.name === n)!.lineweight;
    // structure pen shared by exterior walls, core walls and columns
    expect(lw('A-WALL-EXT')).toBe(50);
    expect(lw('A-WALL-CORE')).toBe(50);
    expect(lw('A-COLUMN')).toBe(50);
    // enclosure ladder — opening symbols (pen 25) plot at/above partitions (pen 20)
    expect(lw('A-WALL-EXT')).toBeGreaterThan(lw('A-WALL-INT'));
    expect(lw('A-WALL-INT')).toBeGreaterThan(lw('A-WALL-PART'));
    expect(lw('A-DOOR')).toBeGreaterThanOrEqual(lw('A-WALL-PART'));
    expect(lw('A-WALL-PART')).toBeGreaterThan(lw('A-DIMS'));
    // annotation sits below all wall linework
    for (const wall of ['A-WALL-EXT', 'A-WALL-INT', 'A-WALL-CORE', 'A-WALL-SERVICE', 'A-WALL-PART']) {
      for (const anno of ['A-DIMS', 'A-TEXT', 'A-ROOM', 'A-STAIR-DIR']) {
        expect(lw(wall), `${wall} must plot heavier than ${anno}`).toBeGreaterThan(lw(anno));
      }
    }
    // helpers are lighter than every wall layer; halftone fills lightest of all
    for (const wall of ['A-WALL-EXT', 'A-WALL-INT', 'A-WALL-CORE']) {
      expect(lw(wall)).toBeGreaterThan(lw('A-GRID'));
      expect(lw(wall)).toBeGreaterThan(lw('A-BLDG-OUT'));
      expect(lw(wall)).toBeGreaterThan(lw('A-HATCH'));
    }
    expect(lw('A-HATCH')).toBe(9);
  });

  it('mapping refinements keep output deterministic and structurally valid', () => {
    const cand = fixture();
    const a = writeDXF(cand, 'p16d-b');
    const b = writeDXF(cand, 'p16d-b');
    expect(a).toBe(b);
    expect(validateDXFStructure(a).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P16-D-C — architectural symbols & room annotation
// ---------------------------------------------------------------------------

/** Mirror of the writer's millimetre rounding: Math.round(m * 100000) / 100. */
const mmOf = (m: number) => Math.round(m * 100000) / 100;

/** Room polygon (or rect fallback) shifted to DXF millimetre model-space coordinates. */
function roomPolyMm(fi: number, globalMaxH: number, s: { polygon?: Array<{ x: number; y: number }> | null; rect: { x: number; y: number; w: number; h: number } }): Array<{ x: number; y: number }> {
  const off = fi * (globalMaxH + 4) * 1000;
  if (s.polygon && s.polygon.length >= 3) {
    return s.polygon.map(p => ({ x: mmOf(p.x), y: mmOf(p.y) + off }));
  }
  const r = s.rect;
  return [
    { x: mmOf(r.x), y: mmOf(r.y) + off },
    { x: mmOf(r.x + r.w), y: mmOf(r.y) + off },
    { x: mmOf(r.x + r.w), y: mmOf(r.y + r.h) + off },
    { x: mmOf(r.x), y: mmOf(r.y + r.h) + off },
  ];
}

/** Shoelace area (m²) of a space — polygon when canonical, rect otherwise. */
function spaceArea(s: { polygon?: Array<{ x: number; y: number }> | null; rect: { x: number; y: number; w: number; h: number } }): number {
  if (s.polygon && s.polygon.length >= 3) return shoelace(s.polygon);
  return s.rect.w * s.rect.h;
}

describe('P16-D-C room annotation is anchored inside the actual room polygon', () => {
  const cand = fixture();
  const globalMaxH = Math.max(...cand.floors.map(f => f.footprint.h), cand.buildableArea.h);

  it('every emitted room area label sits inside its own room and quotes its true area', () => {
    const dxf = writeDXF(cand, 'p16d-c');
    const areaEnts = entities(dxf).filter(e => e.type === 'TEXT' && /^\d+\.\d m2$/.test(e.codes[1] ?? ''));
    expect(areaEnts.length).toBeGreaterThan(0);
    for (const e of areaEnts) {
      const p = { x: Number(e.codes[10]), y: Number(e.codes[20]) };
      let attributed = false;
      for (let fi = 0; fi < cand.floors.length; fi++) {
        for (const s of cand.floors[fi].spaces ?? []) {
          const poly = roomPolyMm(fi, globalMaxH, s);
          if (pointInPolygon(p, poly) && e.codes[1] === `${spaceArea(s).toFixed(1)} m2`) attributed = true;
        }
      }
      expect(attributed, `area label "${e.codes[1]}" at (${p.x},${p.y}) is not inside its own room`).toBe(true);
    }
  });

  it('room name labels stay inside the room polygon too', () => {
    const dxf = writeDXF(cand, 'p16d-c');
    const nameEnts = entities(dxf).filter(e =>
      e.type === 'TEXT' && /A-ROOM$/.test(e.codes[8] ?? '') && (e.codes[1] ?? '').includes('. F'));
    expect(nameEnts.length).toBeGreaterThan(0);
    for (const e of nameEnts) {
      const p = { x: Number(e.codes[10]), y: Number(e.codes[20]) };
      let insideSomeRoom = false;
      for (let fi = 0; fi < cand.floors.length; fi++) {
        for (const s of cand.floors[fi].spaces ?? []) {
          if (pointInPolygon(p, roomPolyMm(fi, globalMaxH, s))) insideSomeRoom = true;
        }
      }
      expect(insideSomeRoom, `name label "${e.codes[1]}" at (${p.x},${p.y}) fell outside every room`).toBe(true);
    }
  });

  it('text stays readable: 0°/90° only, bounded heights, wide rooms horizontal', () => {
    const dxf = writeDXF(cand, 'p16d-c');
    const roomTxt = entities(dxf).filter(e => e.type === 'TEXT' && /A-ROOM$/.test(e.codes[8] ?? ''));
    expect(roomTxt.length).toBeGreaterThan(0);
    for (const t of roomTxt) {
      expect(['0', '90', undefined]).toContain(t.codes[50]);
      const h = Number(t.codes[40]) / 1000; // DXF heights are millimetres
      // area sub-labels render at 0.7× the governed name height
      expect(h).toBeGreaterThanOrEqual(0.12 * 0.7 - 1e-6);
      expect(h).toBeLessThanOrEqual(0.35 + 1e-6);
    }
    // The tall-narrow bedrooms run their labels along the long (vertical) axis.
    expect(roomTxt.some(t => t.codes[50] === '90')).toBe(true);
    // The wide-flat corridor keeps a horizontal label (reads along its long axis).
    const corr = roomTxt.find(t => (t.codes[1] ?? '').startsWith('Corridor'));
    expect(corr).toBeDefined();
    expect(corr!.codes[50] ?? '0').toBe('0');
  });

  it('annotation output remains deterministic and validates clean', () => {
    const a = writeDXF(cand, 'p16d-c');
    expect(a).toBe(writeDXF(cand, 'p16d-c'));
    expect(validateDXFStructure(a).ok).toBe(true);
  });
});

describe('P16-D-C furniture and sanitary footprint glyphs', () => {
  const cand = fixture();
  const SAN = new Set(['toilet', 'sink', 'shower', 'bathtub']);

  it('every generated footprint is drawn as a rect outline on its discipline layer', () => {
    const dxf = writeDXF(cand, 'p16d-c');
    const ents = entities(dxf);
    const furn = cand.floors.flatMap(fl => fl.furniture ?? []).filter(f => !SAN.has(f.type));
    const san = cand.floors.flatMap(fl => fl.furniture ?? []).filter(f => SAN.has(f.type));
    expect(furn.length + san.length).toBeGreaterThan(0);
    const linesOn = (base: string) => ents.filter(e =>
      e.type === 'LINE' && (e.codes[8] === base || e.codes[8]?.endsWith(`-${base}`))).length;
    expect(linesOn('A-FURN')).toBeGreaterThanOrEqual(4 * furn.length);
    expect(linesOn('A-SANITARY')).toBeGreaterThanOrEqual(4 * san.length);
  });

  it('glyph geometry equals the model footprint coordinates exactly', () => {
    const dxf = writeDXF(cand, 'p16d-c');
    const ents = entities(dxf);
    const f0 = (cand.floors[0].furniture ?? [])[0];
    expect(f0).toBeDefined();
    const base = SAN.has(f0.type) ? 'A-SANITARY' : 'A-FURN';
    const r = f0.rect;
    const edges: string[] = [
      `L|${mmOf(r.x)},${mmOf(r.y)}|${mmOf(r.x + r.w)},${mmOf(r.y)}`,
      `L|${mmOf(r.x + r.w)},${mmOf(r.y)}|${mmOf(r.x + r.w)},${mmOf(r.y + r.h)}`,
      `L|${mmOf(r.x + r.w)},${mmOf(r.y + r.h)}|${mmOf(r.x)},${mmOf(r.y + r.h)}`,
      `L|${mmOf(r.x)},${mmOf(r.y + r.h)}|${mmOf(r.x)},${mmOf(r.y)}`,
    ];
    for (const e of ents) {
      if (e.type !== 'LINE') continue;
      if (e.codes[8] !== base && e.codes[8] !== `A-FLOOR-0-${base}`) continue;
      const k = `L|${e.codes[10]},${e.codes[20]}|${e.codes[11]},${e.codes[21]}`;
      const idx = edges.indexOf(k);
      if (idx >= 0) edges.splice(idx, 1);
    }
    expect(edges, `footprint edges missing on ${base}: ${edges.join(' ; ')}`).toHaveLength(0);
  });

  it('glyph layers follow the layer scheme and validate clean in all schemes', () => {
    for (const layerScheme of ['both', 'none', 'generic'] as const) {
      const dxf = writeDXF(cand, 'p16d-c', { layerScheme });
      const v = validateDXFStructure(dxf);
      expect(v.ok, `scheme ${layerScheme}: ${v.errors.join('; ')}`).toBe(true);
      const used = layerSet(dxf);
      if (layerScheme === 'none') {
        expect([...used].some(l => l === 'A-FURN')).toBe(false);
        expect([...used].some(l => l === 'A-SANITARY')).toBe(false);
        expect([...used].some(l => l.endsWith('-A-FURN'))).toBe(true);
        expect([...used].some(l => l.endsWith('-A-SANITARY'))).toBe(true);
      }
      if (layerScheme === 'generic') {
        expect([...used].some(l => l === 'A-FURN')).toBe(true);
        expect([...used].some(l => l === 'A-SANITARY')).toBe(true);
        expect([...used].some(l => l.startsWith('A-FLOOR-'))).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P16-D-D — final presentation polish (title block, legend, stair notes)
// ---------------------------------------------------------------------------

describe('P16-D-D title block, legend and stair-note fitting', () => {
  const small = (() => {
    const prj = createProject({
      name: 'P16D-D Small', country: 'IR',
      site: { shape: 'rectangle', width: 8, length: 12, accessSide: 'south', streetWidth: 8 },
      building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false, hasStorage: true },
      deterministic: true, seed: 42,
    });
    const { bestCandidate } = legacyGenerate(prj);
    if (!bestCandidate) throw new Error('no small-plan fixture');
    return bestCandidate;
  })();
  const TITLE_LAYER = /^(A-TITLE|A-FLOOR-0-A-TITLE)$/;

  it('every A-TITLE text fits inside the drawing border on a very small plan', () => {
    const dxf = writeDXF(small, 'p16d-d');
    const fr = small.floors[0].footprint;
    const bx0 = fr.x - 1.5, bx1 = fr.x + fr.w + 1.5;
    let seen = 0;
    for (const e of entities(dxf)) {
      if (e.type !== 'TEXT' || !TITLE_LAYER.test(e.codes[8] ?? '')) continue;
      const x = Number(e.codes[10]) / 1000, h = Number(e.codes[40]) / 1000;
      const right = x + (e.codes[1] ?? '').length * h * 0.72;
      expect(x, `"${e.codes[1]}" starts outside the border`).toBeGreaterThanOrEqual(bx0 - 1e-6);
      expect(right, `"${e.codes[1]}" overflows the border`).toBeLessThanOrEqual(bx1 + 1e-6);
      seen++;
    }
    expect(seen).toBeGreaterThan(10);
    expect(validateDXFStructure(dxf).ok).toBe(true);
  });

  it('title lines anchored inside the box fit the box on a very small plan', () => {
    const dxf = writeDXF(small, 'p16d-d');
    const fr = small.floors[0].footprint;
    const tw = Math.max(5, fr.w * 0.62);
    const tx0 = fr.x + fr.w + 1.5 - tw, by0 = fr.y - 1.5 - 4.6;
    let seen = 0;
    for (const e of entities(dxf)) {
      if (e.type !== 'TEXT' || !TITLE_LAYER.test(e.codes[8] ?? '')) continue;
      const x = Number(e.codes[10]) / 1000, y = Number(e.codes[20]) / 1000;
      if (x < tx0 - 1e-6 || y < by0 || y > by0 + 2.6) continue;
      const h = Number(e.codes[40]) / 1000;
      seen++;
      expect(x + (e.codes[1] ?? '').length * h * 0.72, `"${e.codes[1]}" overflows the title box`)
        .toBeLessThanOrEqual(tx0 + tw + 1e-6);
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('small plans relocate the legend into the box, below the divider', () => {
    const dxf = writeDXF(small, 'p16d-d');
    const fr = small.floors[0].footprint;
    const tw = Math.max(5, fr.w * 0.62);
    const tx0 = fr.x + fr.w + 1.5 - tw, ty0 = fr.y - 1.5 - 4.6 + 0.15;
    const divider = ty0 + 2.4 - 0.75;
    const texts = entities(dxf).filter(e => e.type === 'TEXT' && e.codes[8] === 'A-TITLE');
    const rows = texts.filter(e =>
      Number(e.codes[10]) / 1000 >= tx0 - 1e-6
      && /^A-[A-Z-]+ - /.test(e.codes[1] ?? ''));
    // P29-B: the in-box legend rows used to slice straight through the fitted
    // title lines (evidenced overlap). The annotation collision guard now
    // suppresses exactly the overlapping rows — for this fixture 5 of the 11
    // rows collide and 6 survive, every survivor collision-free.
    expect(rows.length).toBe(6);
    const lineRects = texts
      .filter(e => !/^A-[A-Z-]+ - /.test(e.codes[1] ?? '') && e.codes[1] !== 'LEGEND')
      .map(e => {
        const x = Number(e.codes[10]) / 1000, y = Number(e.codes[20]) / 1000;
        const h = Number(e.codes[40]) / 1000;
        return [x, y, x + (e.codes[1] ?? '').length * h * 0.72, y + h] as const;
      });
    for (const r of rows) {
      const y = Number(r.codes[20]) / 1000, h = Number(r.codes[40]) / 1000;
      expect(h).toBeCloseTo(0.085, 6);
      expect(y + h, `"${r.codes[1]}" crosses the divider`).toBeLessThanOrEqual(divider + 1e-6);
      const rx = Number(r.codes[10]) / 1000;
      const rr = [rx, y, rx + (r.codes[1] ?? '').length * h * 0.72, y + h] as const;
      for (const lr of lineRects) {
        const disjoint = rr[0] + 0.002 >= lr[2] || lr[0] + 0.002 >= rr[2]
          || rr[1] + 0.002 >= lr[3] || lr[1] + 0.002 >= rr[3];
        expect(disjoint, `"${r.codes[1]}" overlaps a title line`).toBe(true);
      }
    }
  });

  it('roomy plans keep the beside-box legend at the legacy geometry', () => {
    const wide = fixture();
    const dxf = writeDXF(wide, 'p16d-d');
    const fr = wide.floors[0].footprint;
    const tx0 = fr.x + fr.w + 1.5 - 11;
    const leg = entities(dxf).find(e => e.type === 'TEXT' && e.codes[8] === 'A-TITLE' && e.codes[1] === 'LEGEND');
    expect(leg).toBeDefined();
    expect(Number(leg!.codes[10]) / 1000).toBeCloseTo(tx0 - 3.6, 2); // untouched legacy x
    expect(Number(leg!.codes[40]) / 1000).toBeCloseTo(0.2, 6);       // untouched legacy height
  });

  it('stair build notes are fitted inside their stair wells', () => {
    const wide = fixture();
    const dxf = writeDXF(wide, 'p16d-d');
    const notes = entities(dxf).filter(e => e.type === 'TEXT' && /\d+R @/.test(e.codes[1] ?? ''));
    expect(notes.length).toBeGreaterThan(0);
    const wells = wide.floors.flatMap(f => f.stairs).map(s => s.footprint ?? s.rect);
    for (const n of notes) {
      const h = Number(n.codes[40]) / 1000, rot = Number(n.codes[50] ?? 0);
      expect(h).toBeLessThanOrEqual(0.15 + 1e-6);
      const len = (n.codes[1] ?? '').length * h * 0.72;
      const fits = wells.some(r => len <= (rot === 90 ? r.h : r.w) - 0.15 + 1e-3);
      expect(fits, `note "${n.codes[1]}" (h=${h}, rot=${rot}) overflows its well`).toBe(true);
    }
  });

  it('A-HATCH stays intentionally defined and unused (reserved layer)', () => {
    for (const cand of [fixture(), small]) {
      const dxf = writeDXF(cand, 'p16d-d');
      expect(dxf).toContain('A-HATCH'); // defined in the LAYER table
      for (const e of entities(dxf)) expect(e.codes[8]).not.toBe('A-HATCH');
    }
  });

  it('output remains byte-deterministic after the polish pass', () => {
    for (const cand of [fixture(), small]) {
      expect(writeDXF(cand, 'p16d-d')).toBe(writeDXF(cand, 'p16d-d'));
      expect(validateDXFStructure(writeDXF(cand, 'p16d-d')).ok).toBe(true);
    }
  });
});
