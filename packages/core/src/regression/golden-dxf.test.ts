/**
 * Golden DXF regression fixtures.
 *
 * A small, fixed set of plans is generated through the same production path as
 * the web app's DXF export (createProject → generate({ allStrategies: true }) →
 * exportDXF(bestCandidate, name)), and the output must match the committed
 * golden files byte-for-byte. The DXF writer is NOT changed or normalized here:
 * any difference is a real change in generated CAD output.
 *
 * Frozen profile checked on every fixture: ASCII DXF R12, HEADER containing only
 * `$ACADVER = AC1009`, no NaN / Infinity / undefined values, and the existing
 * structural validator (validateDXFStructure) passes.
 *
 * Regenerating after an intentional, reviewed output change:
 *   UPDATE_GOLDEN_DXF=1 npx vitest run src/regression/golden-dxf.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createProject, generate, exportDXF } from '../pipeline.js';
import { validateDXFStructure } from '../dxf/writer.js';
import { parseDxf } from '../dxf/verify.js';
import type { ProjectInput } from '../model/project.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden-dxf');
const INDEX_FILE = path.join(FIXTURE_DIR, 'index.json');
const UPDATE = process.env.UPDATE_GOLDEN_DXF === '1';

const VILLA_2F = { type: 'villa', bedrooms: 2, masterBedrooms: 1, bathrooms: 1, wc: 1, parkingSpaces: 1, kitchenType: 'closed', hasStair: true, floors: 2 } as const;

interface GoldenCase { id: string; covers: string[]; input: ProjectInput }

export const GOLDEN_DXF_CASES: GoldenCase[] = [
  {
    id: 'rect-1f',
    covers: ['rectangular', 'single floor'],
    input: {
      name: 'Golden rect 1F',
      site: { shape: 'rectangle', width: 18, length: 25, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2 },
      building: { ...VILLA_2F, bedrooms: 1, parkingSpaces: 0, kitchenType: 'open', hasStair: false, floors: 1 },
      seed: 42, jurisdiction: 'IR',
    } as unknown as ProjectInput,
  },
  {
    id: 'lshape-2f-stair',
    covers: ['L-shaped site', 'multi-floor', 'stair'],
    input: {
      name: 'Golden L 2F',
      site: {
        shape: 'l-shape', width: 20, length: 26, streetWidth: 8, accessSide: 'south', setbackNorth: 3, setbackSouth: 1.5, setbackEast: 2, setbackWest: 2,
        lShape: { width: 20, length: 26, notchWidth: 4, notchLength: 6, notchCorner: 'north-east' },
      },
      building: VILLA_2F,
      seed: 42, jurisdiction: 'IR',
    } as unknown as ProjectInput,
  },
  {
    id: 'decimal-asym-2f-stair',
    covers: ['rectangular', 'decimal dimensions', 'asymmetric setbacks', 'east access', 'multi-floor', 'stair'],
    input: {
      name: 'Golden decimal 2F',
      site: { shape: 'rectangle', width: 17.5, length: 24.3, streetWidth: 9.5, accessSide: 'east', setbackNorth: 2.25, setbackSouth: 1.75, setbackEast: 1.5, setbackWest: 2.6 },
      building: VILLA_2F,
      seed: 7, jurisdiction: 'IR',
    } as unknown as ProjectInput,
  },
];

/** Production export path (mirrors packages/web App.tsx). */
function produce(c: GoldenCase) {
  const r = generate(createProject(JSON.parse(JSON.stringify(c.input))), { allStrategies: true });
  if (!r.bestCandidate) throw new Error(`golden case ${c.id} is infeasible`);
  const { dxf, validation } = exportDXF(r.bestCandidate, (c.input as { name?: string }).name);
  return { dxf, validation, candidate: r.bestCandidate };
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fixturePath = (id: string) => path.join(FIXTURE_DIR, `${id}.dxf`);

interface IndexEntry { id: string; file: string; bytes: number; sha256: string; strategy: string; floors: number; stairs: number; covers: string[] }

if (UPDATE) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const index: IndexEntry[] = [];
  for (const c of GOLDEN_DXF_CASES) {
    const { dxf, candidate } = produce(c);
    const buf = Buffer.from(dxf, 'utf8');
    fs.writeFileSync(fixturePath(c.id), buf);
    index.push({
      id: c.id, file: `${c.id}.dxf`, bytes: buf.length, sha256: sha256(buf), strategy: candidate.metadata.strategy,
      floors: candidate.floors.length, stairs: candidate.floors.reduce((s, f) => s + f.stairs.length, 0), covers: c.covers,
    });
  }
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ description: 'Golden DXF regression fixtures — see src/regression/golden-dxf.test.ts', fixtures: index }, null, 2) + '\n');
}

const NUMERIC_CODE = (code: number) =>
  (code >= 10 && code <= 59) || (code >= 60 && code <= 79) || (code >= 210 && code <= 239) || (code >= 1010 && code <= 1071);

describe('golden DXF fixtures — index', () => {
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) as { fixtures: IndexEntry[] };

  it('lists exactly the golden cases, and every committed file matches its recorded size and sha256', () => {
    expect(index.fixtures.map(f => f.id)).toEqual(GOLDEN_DXF_CASES.map(c => c.id));
    for (const f of index.fixtures) {
      const buf = fs.readFileSync(path.join(FIXTURE_DIR, f.file));
      expect(buf.length, f.id).toBe(f.bytes);
      expect(sha256(buf), f.id).toBe(f.sha256);
    }
  });

  it('covers rectangular, L-shaped, multi-floor with stair, and decimal/asymmetric input', () => {
    const covers = new Set(index.fixtures.flatMap(f => f.covers));
    for (const need of ['rectangular', 'L-shaped site', 'multi-floor', 'stair', 'decimal dimensions', 'asymmetric setbacks']) expect(covers.has(need), need).toBe(true);
    expect(index.fixtures.some(f => f.floors >= 2 && f.stairs >= 1)).toBe(true);
  });
});

for (const c of GOLDEN_DXF_CASES) {
  describe(`golden DXF — ${c.id}`, () => {
    const first = produce(c);
    const golden = fs.readFileSync(fixturePath(c.id));

    it('generation is deterministic (two runs are identical)', () => {
      expect(produce(c).dxf).toBe(first.dxf);
    });

    it('matches the committed golden fixture byte-for-byte', () => {
      const out = Buffer.from(first.dxf, 'utf8');
      expect(out.length).toBe(golden.length);
      expect(out.equals(golden)).toBe(true);
    });

    it('is pure ASCII R12 with CRLF pairs, a HEADER holding only $ACADVER = AC1009, and a trailing EOF', () => {
      for (const byte of golden) expect(byte < 0x80).toBe(true);
      const text = golden.toString('ascii');
      const parsed = parseDxf(text);
      expect(parsed.errors).toEqual([]);
      expect(parsed.headerVars).toEqual({ $ACADVER: 'AC1009' });
      expect(text.startsWith('0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n$ACADVER\r\n1\r\nAC1009\r\n')).toBe(true);
      expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false);
      expect(text.endsWith('0\r\nEOF\r\n')).toBe(true);
    });

    it('contains no NaN / Infinity / undefined, and every numeric group value is finite', () => {
      const text = golden.toString('ascii');
      expect(/NaN|Infinity|undefined/.test(text)).toBe(false);
      const lines = text.split('\r\n');
      if (lines[lines.length - 1] === '') lines.pop();
      expect(lines.length % 2).toBe(0);
      let numeric = 0;
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = Number(lines[i].trim());
        expect(Number.isInteger(code), `group code at line ${i + 1}`).toBe(true);
        if (NUMERIC_CODE(code)) {
          const v = Number(lines[i + 1].trim());
          expect(Number.isFinite(v), `code ${code} value "${lines[i + 1]}" at line ${i + 2}`).toBe(true);
          numeric++;
        }
      }
      expect(numeric).toBeGreaterThan(100);
    });

    it('passes the existing structural validation', () => {
      expect(first.validation.ok).toBe(true);
      const v = validateDXFStructure(golden.toString('ascii'));
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
    });
  });
}
