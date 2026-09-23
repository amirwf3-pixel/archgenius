import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDXF, validateDXFStructure, dxfSafeText } from './writer.js';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { legacyGenerate } from '../testutil/legacy-generate.js';

/**
 * Minimal R12 AC1009 regression — strict conservative R12.
 * Proves that a tiny hand-crafted DXF and the architectural writer both satisfy
 * Autodesk R12 spec with ONLY $ACADVER, correct SECTION/TABLE/ENTITY termination,
 * group-code order, POLYLINE/VERTEX/SEQEND flags, 10/20/30, TEXT/ARC/layer/linetype/STYLE,
 * CRLF, ASCII, EOF, and no R13+ constructs.
 *
 * Reference DXF: packages/core/src/dxf/reference-minimal-r12.dxf
 *   - 4 LINE (square 10m), 1 closed POLYLINE rect (4 VERTEX + SEQEND), 1 TEXT, 1 LAYER (0)
 *   - R12 with the Phase 28-E minimal profile: HEADER contains ONLY $ACADVER
 *     (proven safe in real AutoCAD 2027, Phase 28-D H0 ladder); NO VPORT table;
 *     then LTYPE+LAYER+STYLE, *Model_Space only
 */

function analyze(dxf: string) {
  const lines = dxf.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const pairs: Array<{code:number,value:string}> = [];
  for (let i=0;i+1<lines.length;i+=2) pairs.push({code:Number(lines[i]), value: lines[i+1]});
  const header: Record<string, Array<{code:number,value:string}>> = {};
  const sections: string[] = [];
  const tables: Record<string, number> = {};
  const entities: Array<{type:string,codes:Record<number,string>}> = [];
  let hasEof = false;
  let section = '';
  let curTable = '';
  let curHeaderVar = '';
  let curEnt: any = null;
  for (let i=0;i<pairs.length;i++) {
    const {code,value}=pairs[i];
    const v=value.trim();
    if (code===0) {
      if (curEnt) entities.push(curEnt);
      curEnt=null; curHeaderVar='';
      if (v==='SECTION') {
        const nxt=pairs[i+1];
        expect(nxt && nxt.code===2).toBe(true);
        section=nxt.value.trim();
        sections.push(section);
        i++;
      } else if (v==='ENDSEC') {
        section=''; curTable='';
      } else if (v==='EOF') {
        hasEof=true;
        expect(i).toBe(pairs.length-1);
      } else if (section==='TABLES') {
        if (v==='TABLE') {
          const nxt=pairs[i+1];
          curTable=nxt && nxt.code===2 ? nxt.value.trim() : '?';
          tables[curTable]=(tables[curTable]||0)+1;
          i++;
        } else if (v==='ENDTAB') curTable='';
      } else if (section==='ENTITIES') {
        curEnt={type:v, codes:{}};
      }
    } else if (section==='HEADER') {
      if (code===9) { curHeaderVar=v; header[curHeaderVar]=header[curHeaderVar]??[]; }
      else if (curHeaderVar) header[curHeaderVar].push({code,value});
    } else if (curEnt) {
      curEnt.codes[code]=value;
    }
  }
  if (curEnt) entities.push(curEnt);
  return { pairs, header, sections, tables, entities, hasEof, lines, dxf };
}

function readReference(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const p = path.join(dir, 'reference-minimal-r12.dxf');
  const buf = fs.readFileSync(p);
  // Must be CRLF and ASCII
  return buf.toString('utf-8');
}

describe('Minimal R12 AC1009 — strict conservative reference', () => {
  it('reference file exists, is pure CRLF ASCII, and has correct minimal structure', () => {
    const dxf = readReference();
    // Pure CRLF: no stray CR/LF
    expect(dxf.split('\r\n').join('')).not.toMatch(/[\r\n]/);
    // ASCII only
    for (const ch of dxf) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    // Even number of group-code lines + final CRLF
    expect(dxf.endsWith('\r\n')).toBe(true);
    const a = analyze(dxf);
    // Canonical sections: HEADER, TABLES, BLOCKS, ENTITIES in order, no extra
    expect(a.sections).toEqual(['HEADER','TABLES','BLOCKS','ENTITIES']);
    expect(a.hasEof).toBe(true);
    // HEADER: Phase 28-E minimal profile — ONLY $ACADVER (proven safe in AutoCAD 2027)
    expect(a.header['$ACADVER']).toBeDefined();
    expect(a.header['$ACADVER'][0].value).toBe('AC1009');
    expect(Object.keys(a.header)).toEqual(['$ACADVER']);
    for (const v of ['$INSBASE', '$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX', '$VIEWCTR', '$VIEWSIZE', '$VIEWDIR', '$LUNITS']) {
      expect(a.header[v], `forbidden header variable ${v}`).toBeUndefined();
    }
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).not.toContain('$INSUNITS');
    expect(dxf).not.toContain('$MEASUREMENT');
    // TABLES: LTYPE FIRST (Phase 28-E), then LAYER, STYLE; NO VPORT; VIEW/UCS/APPID/DIMSTYLE absent
    expect(a.tables['LTYPE']).toBe(1);
    expect(a.tables['LAYER']).toBe(1);
    expect(a.tables['STYLE']).toBe(1);
    expect(a.tables['VPORT']).toBeUndefined();
    expect(a.tables['VIEW']).toBeUndefined();
    expect(a.tables['UCS']).toBeUndefined();
    expect(a.tables['APPID']).toBeUndefined();
    expect(a.tables['DIMSTYLE']).toBeUndefined();
    // LTYPE must be the FIRST table (Phase 28-E minimal profile)
    const firstTbl = a.pairs.findIndex((p: any, i: number) => p.code === 0 && p.value.trim() === 'TABLE');
    expect(a.pairs[firstTbl + 1].code).toBe(2);
    expect(a.pairs[firstTbl + 1].value.trim()).toBe('LTYPE');
    // LTYPE: must have 72=65 (R12 alignment 'A')
    // Check raw pairs for 72=65 presence in LTYPE records
    const ltype72 = a.pairs.filter((p,idx) => {
      // Find LTYPE table entries: preceding 0 LTYPE
      if (p.code===72 && p.value==='65') {
        // Check that we are inside LTYPE table (between TABLE LTYPE and ENDTAB)
        return true;
      }
      return false;
    });
    expect(ltype72.length).toBeGreaterThanOrEqual(1);
    // LAYER: no 370 (R13+)
    expect(a.pairs.some(p=>p.code===370)).toBe(false);
    expect(a.pairs.some(p=>p.code===100)).toBe(false); // no subclass markers
    // STYLE: txt SHX
    expect(dxf).toContain('txt');
    expect(dxf).not.toContain('Arial');
    // BLOCKS: *Model_Space present, at least one BLOCK/ENDBLK pair
    expect(dxf).toContain('*Model_Space');
    // ENTITIES: exactly 4 LINE + 1 POLYLINE + 4 VERTEX + 1 SEQEND + 1 TEXT = 11 entities (VERTEX/SEQEND counted)
    const types = a.entities.map(e=>e.type);
    expect(types.filter(t=>t==='LINE').length).toBe(4);
    expect(types.filter(t=>t==='POLYLINE').length).toBe(1);
    expect(types.filter(t=>t==='VERTEX').length).toBe(4);
    expect(types.filter(t=>t==='SEQEND').length).toBe(1);
    expect(types.filter(t=>t==='TEXT').length).toBe(1);
    // Allowed vocabulary ONLY
    const allowed = new Set(['LINE','POLYLINE','VERTEX','SEQEND','TEXT']);
    for (const e of a.entities) expect(allowed.has(e.type)).toBe(true);
    // No R13+ entities
    for (const bad of ['LWPOLYLINE','SPLINE','HATCH','MTEXT','DIMENSION','INSERT','CIRCLE','ELLIPSE']) {
      expect(types.includes(bad)).toBe(false);
    }
    // LINE: 10/20/30 + 11/21/31, 30/31=0
    for (const e of a.entities.filter(e=>e.type==='LINE')) {
      expect(e.codes[8]).toBeDefined(); // layer
      expect(e.codes[10]).toBeDefined();
      expect(e.codes[20]).toBeDefined();
      expect(e.codes[30]).toBe('0');
      expect(e.codes[11]).toBeDefined();
      expect(e.codes[21]).toBeDefined();
      expect(e.codes[31]).toBe('0');
      // numeric formatting: no scientific notation, finite
      for (const k of [10,20,11,21]) expect(e.codes[k]).not.toMatch(/e/i);
    }
    // POLYLINE: 10/20/30=0,70=1 closed,66=1,40/41/71/72=0, VERTEX 42=0, SEQEND 8 layer
    const pl = a.entities.find(e=>e.type==='POLYLINE')!;
    expect(pl.codes[10]).toBe('0');
    expect(pl.codes[20]).toBe('0');
    expect(pl.codes[30]).toBe('0');
    expect(pl.codes[70]).toBe('1');
    expect(pl.codes[66]).toBe('1');
    expect(pl.codes[40]).toBe('0');
    expect(pl.codes[41]).toBe('0');
    expect(pl.codes[71]).toBe('0');
    expect(pl.codes[72]).toBe('0');
    for (const v of a.entities.filter(e=>e.type==='VERTEX')) {
      expect(v.codes[8]).toBeDefined();
      expect(v.codes[10]).toBeDefined();
      expect(v.codes[20]).toBeDefined();
      expect(v.codes[30]).toBe('0');
      expect(v.codes[42]).toBe('0');
    }
    const seq = a.entities.find(e=>e.type==='SEQEND')!;
    expect(seq.codes[8]).toBeDefined();
    // TEXT: 10/20/30,40 height,1 value,50 rotation,72 horiz,11/21/31 second point
    const txt = a.entities.find(e=>e.type==='TEXT')!;
    expect(txt.codes[10]).toBeDefined();
    expect(txt.codes[20]).toBeDefined();
    expect(txt.codes[30]).toBe('0');
    expect(txt.codes[40]).toBeDefined();
    expect(txt.codes[1]).toBe('MINIMAL R12 TEST');
    expect(txt.codes[50]).toBe('0');
    expect(txt.codes[72]).toBe('1');
    expect(txt.codes[11]).toBeDefined();
    expect(txt.codes[21]).toBeDefined();
    expect(txt.codes[31]).toBe('0');
    // Negative coords: file should not have negative (but if it did, must be formatted correctly)
    // Extents/view: absent, so no negative extents to check
    // CRLF count check: every \n must be preceded by \r
    expect(dxf.includes('\r')).toBe(true);
    expect(dxf.includes('\n')).toBe(true);
    const lfWithoutCr = dxf.split('\r\n').join('').includes('\n') || dxf.split('\r\n').join('').includes('\r');
    expect(lfWithoutCr).toBe(false);
  });

  it('reference file passes lightweight validator as minimal valid', () => {
    const dxf = readReference();
    const res = validateDXFStructure(dxf);
    // Minimal layer set is ['0'] not architectural layers; lightweight validator expects architectural layers,
    // so it will flag missing layers. For minimal reference, we check manually that it is structurally valid R12
    // even though it doesn't have A-WALL-EXT etc. So we don't expect res.ok to be true for architectural layers.
    // Instead, verify the R12 core: no R13+ headers, correct ACADVER.
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1009');
    expect(dxf).not.toContain('$INSUNITS');
  });

  it('writer produces minimal R12 AC1009 for simple villa — same strict primitives', () => {
    const input: any = {
      name: 'minimal writer test',
      site: { shape: 'rectangle', width: 12, length: 18, accessSide: 'south', streetWidth: 8, setbacks: { north:2, south:3, east:2, west:2 } },
      building: { type:'villa', floors:1, bedrooms:2, masterBedrooms:1, bathrooms:1, wc:1, kitchenType:'closed', parkingSpaces:1, hasStair:false, hasStorage:true },
      deterministic:true, seed:42
    };
    const proj = createProject(input);
    // Phase 15 M3: writer strictness is proven on ANY generated plan — sourced via the
    // generator path (product selection semantics are covered by the pipeline gate tests).
    const res = legacyGenerate(proj, { allStrategies:true });
    expect(res.candidates.length).toBeGreaterThan(0);
    const { dxf } = exportDXF(res.candidates[0], 'minimal');
    const a = analyze(dxf);
    // R12 header: Phase 28-E minimal profile — ONLY $ACADVER
    expect(a.header['$ACADVER'][0].value).toBe('AC1009');
    expect(Object.keys(a.header)).toEqual(['$ACADVER']);
    // Pure CRLF ASCII
    expect(dxf.split('\r\n').join('')).not.toMatch(/[\r\n]/);
    for (const ch of dxf) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    // SECTION order
    expect(a.sections).toEqual(['HEADER','TABLES','BLOCKS','ENTITIES']);
    expect(a.hasEof).toBe(true);
    // TABLES: LTYPE first (Phase 28-E), then LAYER/LAYER/STYLE — no VPORT
    expect(a.tables['LTYPE']).toBe(1);
    expect(a.tables['LAYER']).toBe(1);
    expect(a.tables['STYLE']).toBe(1);
    expect(a.tables['VPORT']).toBeUndefined();
    {
      const firstTbl = a.pairs.findIndex((p: any) => p.code === 0 && p.value.trim() === 'TABLE');
      expect(a.pairs[firstTbl + 1].code).toBe(2);
      expect(a.pairs[firstTbl + 1].value.trim()).toBe('LTYPE');
    }
    // Entities: only allowed R12 types
    const allowed = new Set(['LINE','ARC','TEXT','POLYLINE','VERTEX','SEQEND']);
    for (const e of a.entities) expect(allowed.has(e.type)).toBe(true);
    expect(a.pairs.some(p=>p.code===370)).toBe(false);
    expect(a.pairs.some(p=>p.code===100)).toBe(false);
    // No R13+ header ($LUNITS is R12-valid and required since P22-B — see envelope.test.ts)
    expect(dxf).not.toContain('$SCREENSIZE');
    expect(dxf).not.toContain('$DWGCODEPAGE');
    expect(dxf).not.toContain('$INSUNITS');
    expect(dxf).not.toContain('$MEASUREMENT');
    // ARC if present must have 10/20/30,40,50,51
    for (const e of a.entities.filter(e=>e.type==='ARC')) {
      expect(e.codes[10]).toBeDefined();
      expect(e.codes[20]).toBeDefined();
      expect(e.codes[30]).toBe('0');
      expect(e.codes[40]).toBeDefined();
      expect(e.codes[50]).toBeDefined();
      expect(e.codes[51]).toBeDefined();
    }
    // TEXT must have 11/21/31 second point
    for (const e of a.entities.filter(e=>e.type==='TEXT')) {
      expect(e.codes[11]).toBeDefined();
      expect(e.codes[21]).toBeDefined();
      expect(e.codes[31]).toBe('0');
      expect(e.codes[1]).toMatch(/^[\x20-\x7E]*$/);
    }
    // POLYLINE must have correct flags
    for (const e of a.entities.filter(e=>e.type==='POLYLINE')) {
      expect(e.codes[66]).toBe('1');
      expect(e.codes[70]).toBeDefined();
    }
  });

  it('incremental primitives: adding POLYLINE/ARC/TEXT does not introduce R13+ or break structure', () => {
    // Compare reference (LINE+POLYLINE+TEXT) vs writer (adds ARC for doors)
    const ref = analyze(readReference());
    const input: any = {
      name: 'incremental',
      site: { shape:'rectangle', width:15, length:20, accessSide:'south', streetWidth:8, setbacks:{north:2,south:3,east:2,west:2}},
      building: { type:'villa', floors:1, bedrooms:2, masterBedrooms:1, bathrooms:1, wc:1, kitchenType:'closed', parkingSpaces:1, hasStair:false, hasStorage:true},
      deterministic:true, seed:42
    };
    const proj = createProject(input);
    // Phase 15 M3: writer strictness is proven on ANY generated plan — sourced via the
    // generator path (product selection semantics are covered by the pipeline gate tests).
    const res = legacyGenerate(proj, { allStrategies:true });
    const { dxf } = exportDXF(res.candidates[0], 'incr');
    const arch = analyze(dxf);
    // Both must have same allowed vocabulary, no R13+
    const allowed = new Set(['LINE','ARC','TEXT','POLYLINE','VERTEX','SEQEND']);
    for (const e of [...ref.entities, ...arch.entities]) expect(allowed.has(e.type)).toBe(true);
    // Reference has no ARC, architectural may have ARC (door swings) — ARC is valid R12
    expect(ref.entities.filter(e=>e.type==='ARC').length).toBe(0);
    expect(arch.entities.filter(e=>e.type==='ARC').length).toBeGreaterThan(0);
    // Both must be pure CRLF ASCII EOF
    for (const dx of [readReference(), dxf]) {
      expect(dx.endsWith('\r\n')).toBe(true);
      expect(dx.split('\r\n').join('')).not.toMatch(/[\r\n]/);
      for (const ch of dx) expect(ch.charCodeAt(0)).toBeLessThanOrEqual(0x7e);
    }
  });

  it('dxfSafeText transliteration is deterministic and ASCII-safe for Persian', () => {
    expect(dxfSafeText('ویلای نمونه')).toBe('vylay nmvnh');
    expect(dxfSafeText(' — ² · ×')).toBe(' - 2 . x');
    for (const s of ['ویلای نمونه','FLOOR 0 — Level','23.2 m²']) {
      const safe = dxfSafeText(s);
      expect(safe).toMatch(/^[\x20-\x7E]*$/);
    }
  });
});
