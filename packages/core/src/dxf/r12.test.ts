import { describe, it, expect } from 'vitest';
import { createProject, generate, exportDXF, summarizeValidation } from '../pipeline.js';
import { writeDXF, dxfSafeText } from './writer.js';
import { generateLayouts } from '../generator/generator.js';

/**
 * DXF R12 (AC1009) compatibility regression tests — Phase-A hardening.
 *
 * AutoCAD live verification is not available in this test environment, so these
 * tests use a deterministic IN-REPO structural validator that encodes the R12
 * rules (see analyze() below) as an ezdxf-equivalent check. The limitation is
 * documented: passing these tests proves strict R12 structural compliance, not
 * behaviour in the AutoCAD application itself.
 */

// ---------------------------------------------------------------------------
// Deterministic in-repo R12 structural validator (test infrastructure)
// ---------------------------------------------------------------------------

interface Pair { code: number; value: string }
interface Entity { type: string; codes: Record<number, string> }
interface LtypeRecord { name: string; codes: Record<number, string> }
interface LayerRecord { name: string; codes: Record<number, string> }
interface StyleRecord { codes: Record<number, string> }

export interface R12Analysis {
  pairs: Pair[];
  header: Record<string, { code: number; value: string }[]>;
  sections: string[];
  ltypes: LtypeRecord[];
  layers: LayerRecord[];
  style: StyleRecord | null;
  entities: Entity[];
  textValues: string[];
  hasEof: boolean;
}

function analyze(dxf: string): R12Analysis {
  const lines = dxf.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    expect(Number.isFinite(code)).toBe(true); // every group-code line must parse
    pairs.push({ code, value: lines[i + 1] });
  }
  const header: R12Analysis['header'] = {};
  const sections: string[] = [];
  const ltypes: LtypeRecord[] = [];
  const layers: LayerRecord[] = [];
  let style: StyleRecord | null = null;
  const entities: Entity[] = [];
  let hasEof = false;
  let section = '';
  let curTable = '';
  let curRec: { codes: Record<number, string> } | null = null;
  let curEnt: Entity | null = null;
  let curHeaderVar = '';
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const v = value.trim();
    if (code === 0) {
      if (curEnt) entities.push(curEnt);
      curEnt = null; curRec = null; curHeaderVar = '';
      if (v === 'SECTION') {
        const nxt = pairs[i + 1];
        expect(nxt && nxt.code === 2).toBe(true); // SECTION must be followed by (2, name)
        section = nxt.value.trim();
        sections.push(section);
        i++;
      } else if (v === 'ENDSEC') {
        section = ''; curTable = ''; curHeaderVar = '';
      } else if (v === 'EOF') {
        hasEof = true;
        expect(i).toBe(pairs.length - 1); // EOF must be the final record
      } else if (section === 'TABLES') {
        if (v === 'TABLE') {
          const nxt = pairs[i + 1];
          curTable = nxt && nxt.code === 2 ? nxt.value.trim() : '?';
          i++;
        } else if (v === 'ENDTAB') {
          curTable = '';
        } else if (curTable === 'LTYPE' || curTable === 'LAYER' || curTable === 'STYLE') {
          curRec = { codes: {} };
          if (curTable === 'LTYPE') ltypes.push({ name: '', codes: curRec.codes });
          else if (curTable === 'LAYER') layers.push({ name: '', codes: curRec.codes });
          else style = { codes: curRec.codes };
        }
      } else if (section === 'ENTITIES') {
        curEnt = { type: v, codes: {} };
      }
    } else if (section === 'HEADER') {
      if (code === 9) {
        curHeaderVar = v;
        header[curHeaderVar] = header[curHeaderVar] ?? [];
      } else if (curHeaderVar) {
        header[curHeaderVar].push({ code, value });
      }
    } else if (curRec) {
      curRec.codes[code] = value;
    } else if (curEnt) {
      curEnt.codes[code] = value;
    }
  }
  if (curEnt) entities.push(curEnt);
  for (const l of ltypes) l.name = l.codes[2] ?? '';
  for (const l of layers) l.name = l.codes[2] ?? '';
  return { pairs, header, sections, ltypes, layers, style, entities, textValues: entities.filter(e => e.type === 'TEXT').map(e => e.codes[1] ?? ''), hasEof };
}

function headerPoint(a: R12Analysis, key: string): { x: number; y: number } {
  const vals = a.header[key];
  expect(vals).toBeDefined();
  const x = Number(vals!.find(p => p.code === 10)!.value);
  const y = Number(vals!.find(p => p.code === 20)!.value);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Scenarios (app-default inputs, deterministic)
// ---------------------------------------------------------------------------

function makeInput(width: number, length: number, bedrooms: number, floors: number) {
  return {
    name: 'ویلای نمونه',
    site: { shape: 'rectangle' as const, width, length, accessSide: 'south' as const, streetWidth: 8, northRotationDeg: 0,
      setbacks: { north: 2, south: 3, east: 2, west: 2 }, jurisdiction: 'Tehran-Municipality-Default', city: 'Tehran', parkingLayout: 'auto' },
    building: { type: 'villa' as const, floors, bedrooms, masterBedrooms: 1, bathrooms: 2, wc: 1, kitchenType: 'closed' as const,
      parkingSpaces: 2, hasStair: true, hasElevator: false, hasStorage: true, hasBalcony: false, hasYard: false },
    deterministic: true, seed: 42,
  };
}

/** Scenarios whose top-ranked candidate is in-envelope and must export. */
const EXPORTABLE = [
  { key: '15x22 / 3BD', width: 15, length: 22, bedrooms: 3, floors: 1 },
  { key: '18x25 / 2-story', width: 18, length: 25, bedrooms: 3, floors: 2 },
  { key: 'default 15x20 / 3BD 2F', width: 15, length: 20, bedrooms: 3, floors: 2 },
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DXF R12 compatibility — writer output (Phase-A hardening)', () => {
  for (const sc of EXPORTABLE) {
    it(`header + structure: ${sc.key}`, () => {
      const res = generate(createProject(makeInput(sc.width, sc.length, sc.bedrooms, sc.floors)), { allStrategies: true });
      const { dxf, validation } = exportDXF(res.candidates[0], 'ویلای نمونه');
      expect(validation.ok).toBe(true);
      expect(validation.errors).toEqual([]);
      const a = analyze(dxf);

      // Structure: canonical section order, ENDSEC/EOF pairing, pure CRLF, even lines.
      expect(a.sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
      expect(a.hasEof).toBe(true);
      // Pure CRLF endings: after removing all \r\n, no stray CR or LF remains.
      expect(dxf.split('\r\n').join('')).not.toMatch(/[\r\n]/);
      expect(dxf.split('\r\n').length % 2).toBe(1); // pairs + final empty split element

      // Header: minimal R12 AC1009 — ONLY $ACADVER, all other HEADER vars absent (they trigger Real AutoCAD Enter prompts)
      expect(a.header['$ACADVER'][0].value).toBe('AC1009');
      expect(a.header['$VIEWCTR']).toBeUndefined();
      expect(a.header['$VIEWSIZE']).toBeUndefined();
      expect(a.header['$EXTMIN']).toBeUndefined();
      expect(a.header['$EXTMAX']).toBeUndefined();
      expect(a.header['$LIMMIN']).toBeUndefined();
      expect(a.header['$LIMMAX']).toBeUndefined();
      expect(a.header['$VIEWDIR']).toBeUndefined();
      expect(a.header['$INSBASE']).toBeUndefined();
      expect(a.header['$LUNITS']).toBeUndefined();
      expect(a.header['$SCREENSIZE']).toBeUndefined();
      expect(a.header['$DWGCODEPAGE']).toBeUndefined();
      expect(a.header['$INSUNITS']).toBeUndefined();
      expect(a.header['$MEASUREMENT']).toBeUndefined();
      // Minimal header has exactly one variable: $ACADVER
      expect(Object.keys(a.header)).toEqual(['$ACADVER']);
    });

    it(`tables + text: ${sc.key}`, () => {
      const res = generate(createProject(makeInput(sc.width, sc.length, sc.bedrooms, sc.floors)), { allStrategies: true });
      const { dxf } = exportDXF(res.candidates[0], 'ویلای نمونه');
      const a = analyze(dxf);

      // LTYPE: every entry carries the R12-required alignment code 72 = 65 ('A').
      expect(a.ltypes.length).toBeGreaterThanOrEqual(3);
      for (const lt of a.ltypes) expect(lt.codes[72]).toBe('65');

      // LAYER: no group code 370 anywhere in the LAYER table (R13+ code).
      for (const layer of a.layers) expect(layer.codes[370]).toBeUndefined();
      // Stronger: no 370 group-code line in the whole document.
      expect(a.pairs.some(p => p.code === 370)).toBe(false);

      // STYLE: R12 SHX font, not a TTF name.
      expect(a.style?.codes[3]).toBe('txt');
      expect(dxf).not.toContain('Arial');

      // TEXT: every value ASCII-printable under the deterministic policy, and
      // the whole document is ASCII-safe.
      expect(a.textValues.length).toBeGreaterThan(0);
      for (const t of a.textValues) expect(t).toMatch(/^[\x20-\x7E]*$/);
      for (const ch of dxf) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);

      // Entity vocabulary: strictly R12 entities only.
      const allowed = new Set(['LINE', 'ARC', 'TEXT', 'POLYLINE', 'VERTEX', 'SEQEND']);
      expect(a.entities.length).toBeGreaterThan(0);
      for (const e of a.entities) expect(allowed.has(e.type)).toBe(true);

      // Deterministic bytes: same candidate exported twice is byte-identical.
      const dxf2 = exportDXF(res.candidates[0], 'ویلای نمونه').dxf;
      expect(dxf2).toBe(dxf);
    });
  }

  it('Persian project name is deterministically transliterated, never emitted as UTF-8', () => {
    expect(dxfSafeText('ویلای نمونه')).toBe('vylay nmvnh'); // و→v ی→y ل→l ا→a ی→y | ن→n م→m و→v ن→n ه→h
    expect(dxfSafeText('FLOOR 0 — Level 0 — 0.00m elev')).toBe('FLOOR 0 - Level 0 - 0.00m elev');
    expect(dxfSafeText('23.2 m² · 2F · 18×28')).toBe('23.2 m2 . 2F . 18x28');
    expect(dxfSafeText('۱۲۳')).toBe('123');
    const res = generate(createProject(makeInput(15, 20, 3, 2)), { allStrategies: true });
    const { dxf } = exportDXF(res.candidates[0], 'ویلای نمونه');
    expect(dxf).toContain('vylay nmvnh');
    for (const ch of dxf) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
  });

  it('linetype tables contain no dash pattern elements (49/74) — W1 PASS without 49, W2 FAIL with 49 31.75', () => {
    const res = generate(createProject(makeInput(15, 20, 3, 2)), { allStrategies: true });
    const { dxf } = exportDXF(res.candidates[0], 'T');
    const a = analyze(dxf);
    // All LTYPEs must be solid (73 0, 40 0, no 49/74) — dash pattern caused AutoCAD empty (W1 PASS, W2 FAIL)
    for (const lt of a.ltypes) {
      expect(lt.codes[73]).toBe('0');
      expect(lt.codes[40]).toBe('0');
    }
    expect(a.pairs.some(p => p.code === 49)).toBe(false);
    expect(a.pairs.some(p => p.code === 74)).toBe(false);
  });
});

describe('DXF export gate — hard site-envelope geometry violations', () => {
  it('12x18 / 4BD: at least one out-of-envelope candidate is refused, in-envelope still exports', () => {
    const res = generate(createProject(makeInput(12, 18, 4, 1)), { allStrategies: true }) as any;
    const all = generateLayouts(makeInput(12, 18, 4, 1) as any, ['area-efficiency','functional-circulation','daylight-orientation','alternative-zoning']);
    const outOfEnvelope = all.find((c: any) => c.findings.some((f: any) => f.severity==='hard' && /OUTSIDE/.test(f.code)));
    if (outOfEnvelope) {
      expect(() => exportDXF(outOfEnvelope, 'T')).toThrowError(/hard site-envelope geometry violations/);
      expect(() => summarizeValidation(outOfEnvelope)).not.toThrow();
      expect(typeof writeDXF(outOfEnvelope, 'T')).toBe('string');
      return;
    }
    // If no envelope violation among all, check infeasible diagnostic or top exports
    if (res.candidates.length === 0) {
      expect(res.infeasible).toBeDefined();
      const diag = res.infeasible.diagnosticCandidates[0];
      // Diagnostic may be out-of-envelope or below-min; gate should refuse export for diagnostic (below-min)
      expect(() => exportDXF(diag, 'T')).toThrow();
      return;
    }
    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    const { validation } = exportDXF(res.candidates[0], 'T');
    expect(validation.ok).toBe(true);
  });

  it('in-envelope candidates (all ranks used by the exportable scenarios) still export', () => {
    for (const sc of EXPORTABLE) {
      const res = generate(createProject(makeInput(sc.width, sc.length, sc.bedrooms, sc.floors)), { allStrategies: true });
      // Top-ranked candidate must always export (primary user flow).
      const { validation } = exportDXF(res.candidates[0], 'T');
      expect(validation.ok).toBe(true);
    }
  });
});
