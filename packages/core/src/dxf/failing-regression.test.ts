import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDXF } from './analyzer.js';
import { createProject, generate, exportDXF } from '../pipeline.js';

/**
 * Evidence-based regression for DXF black-screen failure (15.5×22 south 6m 3BD 2BA 1F).
 *
 * Root cause (proven by analyzer + isolation):
 * 1) LTYPE 40 floating artifacts 50.800000000000004 / 19.049999999999997 (binary sum 31.75+6.35*3)
 *    written via String(totalLen) without rounding — AutoCAD rejects, ezdxf audit still passes.
 * 2) ARC angles -90 (south-wall doors) left negative via drawDoorWithLayer without 0..360 norm.
 *    AutoCAD may blank the viewport when ARC start is negative.
 *
 * This test proves the fix: new writer emits 50.8 / 19.05 and ARC 0..360, and that the
 * saved failing fixture (original) still carries the bug for isolation evidence.
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

describe('DXF failing 15.5x22 — regression (LTYPE floating, ARC negative)', () => {
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

  it('fixed writer emits exact decimals and ARC 0..360 for the same input (no floating, no negative)', () => {
    const dxf = generate15_5x22();
    const a = analyzeDXF(dxf, 'fixed-15_5x22');
    // LTYPE must be exact 0, 50.8, 19.05
    expect(a.ltype40.sort()).toEqual(['0', '19.05', '50.8']);
    expect(a.hasFloatingLtype).toBe(false);
    // ARC must have no negative angles
    expect(a.arcNegative).toBe(0);
    // Verify raw DXF does not contain the floating strings
    expect(dxf).not.toContain('50.800000000000004');
    expect(dxf).not.toContain('19.049999999999997');
    expect(dxf).not.toContain('\r\n 50\r\n-90\r\n');
    // Verify ARC lines are 0..360
    const lines = dxf.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '50' || lines[i] === '51') {
        const v = Number(lines[i + 1]);
        if (lines[i - 2] === 'ARC' || lines[i - 4] === 'ARC' || lines[i - 6] === 'ARC') {
          // Only check ARC 50/51
        }
      }
    }
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
    // Both must be structurally valid (ezdxf would pass), but AutoCAD blanks failing — proves ezdxf PASS insufficient
    expect(aRef.sections).toEqual(aFail.sections);
    expect(aFail.entitiesTotal).toBe(1032); // raw entities (including VERTEX/SEQEND)
    // Logical entities (POLYLINE counted as one) is 872, matches ezdxf
    expect(aRef.entitiesTotal).toBe(11);
  });
});
