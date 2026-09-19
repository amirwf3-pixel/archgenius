import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDXF } from './analyzer.js';
import { createProject, generate, exportDXF } from '../pipeline.js';

/**
 * Evidence-based regression for DXF black-screen failure (15.5×22 south 6m 3BD 2BA 1F).
 *
 * Root cause (proven by AutoCAD isolation T2/W1/W2/V1/V2):
 * - LTYPE dash pattern 49/74 causes AutoCAD to open empty (W1 PASS without 49, W2 FAIL with 49 31.75)
 * - Previous LTYPE 40 floating 50.800000000000004 and ARC -90 were also fixed but insufficient alone.
 * - Minimal fix: LTYPE 73 0, 40 0, no 49/74 for all 3 types (CONTINUOUS/CENTER/DASHED) — T2 PASS.
 */

function generate15_5x22(): string {
  const input: any = {
    name: 'regression 15.5x22 south',
    site: { shape: 'rectangle', width: 15.5, length: 22, accessSide: 'south', streetWidth: 6, setbacks: { north: 2, south: 3, east: 1.5, west: 1.5 } },
    building: { type: 'villa', floors: 1, bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, kitchenType: 'closed', parkingSpaces: 1, hasStair: false, hasStorage: true },
    deterministic: true, seed: 42,
  };
  const proj = createProject(input);
  const res = generate(proj, { allStrategies: true });
  expect(res.candidates.length).toBeGreaterThan(0);
  const cand = res.candidates[0];
  const { dxf } = exportDXF(cand, 'archgenius-r12');
  return dxf;
}

describe('DXF failing 15.5x22 — regression (LTYPE dash pattern, ARC negative)', () => {
  it('saved failing fixture still carries the original bug (for isolation evidence)', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const p = path.join(dir, 'fixtures/failing-15_5x22.dxf');
    expect(fs.existsSync(p)).toBe(true);
    const dxf = fs.readFileSync(p, 'utf-8');
    const a = analyzeDXF(dxf, 'failing-15_5x22.dxf');
    // Original bug: floating LTYPE
    expect(a.ltype40).toContain('50.800000000000004');
    expect(a.ltype40).toContain('19.049999999999997');
    expect(a.hasFloatingLtype).toBe(true);
    // Original bug: ARC negative
    expect(a.arcNegative).toBe(6);
  });

  it('fixed writer emits minimal LTYPE (no 49/74) and ARC 0..360 for the same input (no floating, no negative)', () => {
    const dxf = generate15_5x22();
    const a = analyzeDXF(dxf, 'fixed-15_5x22');
    // LTYPE must be minimal 3x 40 0, 73 0, no dash pattern — W1 PASS, W2 FAIL proved 49/74 fatal
    expect(a.ltype40.sort()).toEqual(['0', '0', '0']);
    expect(a.hasFloatingLtype).toBe(false);
    // No 49/74 dash elements in LTYPE section (AutoCAD fails on them: W1 PASS without 49, W2 FAIL with 49 31.75)
    const ltypeSection = dxf.split('0\r\nSECTION\r\n2\r\nTABLES\r\n')[1]?.split('0\r\nENDSEC\r\n')[0] ?? '';
    expect(ltypeSection).not.toContain('\r\n49\r\n');
    expect(ltypeSection).not.toContain('\r\n74\r\n');
    // LTYPE 73 must be 0 for all (no dash elements)
    const ltype73 = [...ltypeSection.matchAll(/\r\n73\r\n(\d+)/g)].map(m=>m[1]);
    expect(ltype73).toEqual(['0','0','0']);
    // ARC must have no negative angles
    expect(a.arcNegative).toBe(0);
    // Verify raw DXF does not contain the floating strings
    expect(dxf).not.toContain('50.800000000000004');
    expect(dxf).not.toContain('19.049999999999997');
    expect(dxf).not.toContain('\r\n50\r\n-90\r\n');
    // Parse ARC 50/51 specifically
    const pairs: Array<{code:number,value:string}> = [];
    const ls = dxf.split('\r\n'); if (ls[ls.length-1]==='') ls.pop();
    for (let i=0;i+1<ls.length;i+=2) pairs.push({code:Number(ls[i]), value:ls[i+1]});
    let arcNeg = 0;
    for (let i=0;i<pairs.length;i++) if (pairs[i].code===0 && pairs[i].value==='ARC') {
      let a50=null,a51=null;
      for (let j=i+1;j<Math.min(i+15,pairs.length);j++) {
        if (pairs[j].code===50) a50=pairs[j].value;
        if (pairs[j].code===51) a51=pairs[j].value;
        if (a50 && a51) break;
      }
      if (a50!==null) { const n=Number(a50); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(360); if (n<0) arcNeg++; }
      if (a51!==null) { const n=Number(a51); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(360); if (n<0) arcNeg++; }
    }
    expect(arcNeg).toBe(0);
  });

  it('fixed writer is deterministic and passes analyzer + CRLF/ASCII invariants', () => {
    const dxf1 = generate15_5x22();
    const dxf2 = generate15_5x22();
    expect(dxf1).toEqual(dxf2);
    const a = analyzeDXF(dxf1, 'fixed-15_5x22');
    expect(a.evenLines).toBe(true);
    expect(a.endsWithCRLF).toBe(true);
    expect(a.strayLF).toBe(false);
    expect(a.strayCR).toBe(false);
    expect(a.hasNonAscii).toBe(false);
    expect(a.hasEof).toBe(true);
    expect(a.sections).toEqual(['HEADER','TABLES','BLOCKS','ENTITIES']);
    expect(a.missingSeqend).toBe(0);
    expect(a.vertexOutside).toBe(0);
    expect(a.dupHandles).toBe(0);
    expect(a.has1e20).toBe(false);
    expect(a.undefinedLayers.length).toBe(0);
    expect(a.undefinedLtypes.length).toBe(0);
  });

  it('isolates: reference minimal vs failing — failing has floating LTYPE + negative ARC, reference has none', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const ref = fs.readFileSync(path.join(dir, 'reference-minimal-r12.dxf'), 'utf-8');
    const fail = fs.readFileSync(path.join(dir, 'fixtures/failing-15_5x22.dxf'), 'utf-8');
    const aRef = analyzeDXF(ref, 'reference-minimal-r12.dxf');
    const aFail = analyzeDXF(fail, 'failing-15_5x22.dxf');
    expect(aRef.hasFloatingLtype).toBe(false);
    expect(aRef.arcNegative).toBe(0);
    expect(aFail.hasFloatingLtype).toBe(true);
    expect(aFail.arcNegative).toBe(6);
    expect(aRef.sections).toEqual(aFail.sections);
    expect(aFail.entitiesTotal).toBe(1032);
    expect(aRef.entitiesTotal).toBe(11);
  });

  it('generated DXF contains no LTYPE 49/74 dash pattern (regression for W2 FAIL)', () => {
    const dxf = generate15_5x22();
    // Global check: no 49/74 in LTYPE — W1 PASS without them, W2 FAIL with 49 31.75
    expect(dxf).not.toContain('\r\n49\r\n31.75\r\n');
    expect(dxf).not.toContain('\r\n49\r\n-6.35\r\n');
    expect(dxf).not.toContain('\r\n49\r\n12.7\r\n');
    // Ensure LTYPE section has no 49 at all
    const tables = dxf.split('0\r\nSECTION\r\n2\r\nTABLES\r\n')[1]?.split('0\r\nENDSEC\r\n')[0] ?? '';
    const has49InLtype = tables.includes('\r\n49\r\n');
    expect(has49InLtype).toBe(false);
  });
});
