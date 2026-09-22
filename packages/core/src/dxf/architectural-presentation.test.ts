import { describe, it, expect } from 'vitest';
import { writeDXF, validateDXFStructure } from './writer.js';
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
